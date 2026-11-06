import { test, expect } from '@playwright/test';
import {
  newUser, sharedBoard, openBoard, dragCard, cardIn, column, holdRequests, restartServer, descriptionOf,
} from './helpers.js';

/**
 * Two real browsers (docs/08 — Playwright; docs/11 concurrency matrix). Every test ends with both
 * clients showing what the database holds.
 */
let alice;
let bob;

test.beforeEach(async ({ browser }) => {
  alice = await newUser(browser, 'Alice');
  bob = await newUser(browser, 'Bob');
});
test.afterEach(async () => {
  await alice.context.close();
  await bob.context.close();
});

test('two users stay in sync: a drag and a create propagate both ways', async () => {
  const { boardId } = await sharedBoard(alice, bob);
  await openBoard(alice.page, boardId);
  await openBoard(bob.page, boardId);

  await dragCard(alice.page, 'Task 1', 'Done');
  await expect(cardIn(bob.page, 'Done', 'Task 1')).toBeVisible();
  await expect(cardIn(bob.page, 'To Do', 'Task 1')).toHaveCount(0);

  const doing = column(bob.page, 'Doing');
  await doing.getByRole('button', { name: '+ Add a card' }).click();
  await doing.getByLabel('Card title').fill('From Bob');
  await doing.getByLabel('Card title').press('Enter');
  await expect(cardIn(alice.page, 'Doing', 'From Bob')).toBeVisible();

  // Presence: each sees the other in the header.
  await expect(alice.page.getByRole('list', { name: /viewing/ }).getByLabel('Bob')).toBeVisible();
});

test('same description edited by both → conflict banner; "Keep mine" wins on purpose', async () => {
  const { boardId, cards } = await sharedBoard(alice, bob);
  const id = cards['Task 1']._id;
  await alice.page.goto(`/b/${boardId}/c/${id}`);
  await bob.page.goto(`/b/${boardId}/c/${id}`);

  const bobSave = await holdRequests(bob.page, '**/api/cards/*/content');
  await bob.page.getByLabel('Description').fill('Bob text');
  await expect.poll(bobSave.held).toBe(1);                         // Bob's save is on the wire, based on version 0

  await alice.page.getByLabel('Description').fill('Alice text');
  await expect(alice.page.getByText('All changes saved')).toBeVisible();
  await expect(bob.page.getByText('Alice changed this')).toBeVisible();   // the pill on Bob's dirty field

  bobSave.release();
  const banner = bob.page.getByRole('alert');
  await expect(banner).toContainText('Alice changed the description while you were editing');
  await expect.poll(() => descriptionOf(bob.page)).toBe('Bob text');           // never silently overwritten

  await banner.getByRole('button', { name: 'Keep mine' }).click();
  await expect(bob.page.getByText('All changes saved')).toBeVisible();
  await expect.poll(() => descriptionOf(alice.page)).toBe('Bob text');
  expect((await alice.api('GET', `/cards/${id}`)).card.description).toBe('Bob text');
});

test('title vs description at the same time → no banner, both saved', async () => {
  const { boardId, cards } = await sharedBoard(alice, bob);
  const id = cards['Task 1']._id;
  await alice.page.goto(`/b/${boardId}/c/${id}`);
  await bob.page.goto(`/b/${boardId}/c/${id}`);

  const bobSave = await holdRequests(bob.page, '**/api/cards/*/content');
  await bob.page.getByLabel('Description').fill('Bob desc');
  await expect.poll(bobSave.held).toBe(1);
  await alice.page.getByLabel('Card title').fill('Alice title');
  await expect(alice.page.getByText('All changes saved')).toBeVisible();

  bobSave.release();                                                 // 409 → three-way check → silent retry
  await expect(bob.page.getByText('All changes saved')).toBeVisible();
  await expect(bob.page.getByRole('alert')).toHaveCount(0);
  await expect(bob.page.getByLabel('Card title')).toHaveValue('Alice title');
  await expect.poll(() => descriptionOf(alice.page)).toBe('Bob desc');
  const { card } = await alice.api('GET', `/cards/${id}`);
  expect(card).toMatchObject({ title: 'Alice title', description: 'Bob desc' });
});

test('a card deleted by Alice closes the modal Bob has open', async () => {
  const { boardId, cards } = await sharedBoard(alice, bob);
  await bob.page.goto(`/b/${boardId}/c/${cards['Task 2']._id}`);
  await expect(bob.page.getByLabel('Card title')).toHaveValue('Task 2');
  await alice.api('DELETE', `/cards/${cards['Task 2']._id}`);
  await expect(bob.page.getByText('This card was deleted')).toBeVisible();
  await expect(bob.page).toHaveURL(new RegExp(`/b/${boardId}$`));
  await expect(cardIn(bob.page, 'To Do', 'Task 2')).toHaveCount(0);
});

test('server restart: both reconnect and resync with no user action, including a missed change', async ({ request }) => {
  const { boardId, cards } = await sharedBoard(alice, bob);
  await openBoard(alice.page, boardId);
  await openBoard(bob.page, boardId);

  const restarting = restartServer(request, { downMs: 2500, renameCard: { cardId: cards['Task 1']._id, title: 'Renamed while down' } });
  await expect(alice.page.getByText('Reconnecting…')).toBeVisible();
  await expect(bob.page.getByText('Reconnecting…')).toBeVisible();
  await restarting;

  for (const { page } of [alice, bob]) {
    await expect(page.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20_000 });
    await expect(cardIn(page, 'To Do', 'Renamed while down')).toBeVisible();     // its event was lost; resync found it
  }
  // And the live stream works again afterwards.
  await dragCard(alice.page, 'Task 2', 'Doing');
  await expect(cardIn(bob.page, 'Doing', 'Task 2')).toBeVisible();
});

test('member removal: Bob loses the board immediately', async () => {
  const { boardId } = await sharedBoard(alice, bob);
  await openBoard(alice.page, boardId);
  await openBoard(bob.page, boardId);

  alice.page.on('dialog', (d) => d.accept());
  await alice.page.getByRole('button', { name: 'Members' }).click();
  await alice.page.getByRole('listitem').filter({ hasText: 'Bob' }).getByRole('button', { name: 'Remove' }).click();

  await expect(bob.page.getByRole('heading', { name: 'You no longer have access' })).toBeVisible();
  await expect(alice.page.getByRole('listitem').filter({ hasText: 'Bob' })).toHaveCount(0);
});

test('a viewer gets a read-only board and still sees live changes', async () => {
  const { boardId } = await sharedBoard(alice, bob, { role: 'viewer' });
  await openBoard(bob.page, boardId);
  await expect(bob.page.getByText('View only')).toBeVisible();
  await expect(bob.page.getByRole('button', { name: '+ Add a card' })).toHaveCount(0);
  await expect(bob.page.getByRole('button', { name: '+ Add a list' })).toHaveCount(0);

  await openBoard(alice.page, boardId);
  await dragCard(alice.page, 'Task 2', 'Done');
  await expect(cardIn(bob.page, 'Done', 'Task 2')).toBeVisible();
});

test('a move that fails (server unreachable) snaps back to its confirmed place, with a toast', async () => {
  const { boardId } = await sharedBoard(alice, bob);
  await openBoard(alice.page, boardId);
  await openBoard(bob.page, boardId);
  // Hold the request, then fail it, so the optimistic state is observable on fast machines too.
  let fail;
  const failed = new Promise((r) => { fail = r; });
  await alice.page.route('**/api/cards/*/move', async (route) => {
    await failed;
    await route.abort('connectionrefused');
  });

  await dragCard(alice.page, 'Task 1', 'Done');                        // instant, optimistic
  fail();
  await expect(alice.page.getByText('Could not reach the server')).toBeVisible();
  await expect(cardIn(alice.page, 'To Do', 'Task 1')).toBeVisible();   // rolled back
  await expect(cardIn(alice.page, 'Done', 'Task 1')).toHaveCount(0);
  await expect(cardIn(bob.page, 'To Do', 'Task 1')).toBeVisible();     // nothing reached the server
});
