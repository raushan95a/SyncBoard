import { expect } from '@playwright/test';

export const BASE = 'http://localhost:4100';
let seq = 0;

/**
 * A signed-in user in their own browser context (own cookies = a separate "browser").
 * `api(method, path, data)` calls the REST API as that user.
 */
export async function newUser(browser, name) {
  const context = await browser.newContext({ baseURL: BASE });
  const email = `${name.toLowerCase()}-${Date.now()}-${++seq}@e2e.io`;
  const res = await context.request.post('/api/auth/register', { data: { name, email, password: 'password123' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const user = (await res.json()).data.user;
  const api = async (method, path, data) => {
    const r = await context.request.fetch(`/api${path}`, { method, ...(data && { data }) });
    const json = await r.json().catch(() => null);
    if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${JSON.stringify(json)}`);
    return json.data;
  };
  return { context, page: await context.newPage(), user, email, name, api };
}

/** Alice's board (basic template) with cards in To Do, and Bob as `role`. */
export async function sharedBoard(alice, bob, { role = 'editor', cards = ['Task 1', 'Task 2'] } = {}) {
  const { board } = await alice.api('POST', '/boards', { title: `E2E ${Date.now()}` });
  if (bob) await alice.api('POST', `/boards/${board._id}/members`, { email: bob.email, role });
  const snap = await alice.api('GET', `/boards/${board._id}`);
  const lists = Object.fromEntries(snap.lists.map((l) => [l.title, l]));
  const created = {};
  for (const title of cards) created[title] = (await alice.api('POST', `/lists/${lists['To Do']._id}/cards`, { title })).card;
  return { boardId: board._id, lists, cards: created };
}

export const column = (page, title) => page.locator(`section.list[data-list="${title}"]`);
export const cardIn = (page, list, title) => column(page, list).locator('.list__cards > li', { hasText: title });

/** Opens the board and waits until it's live (joined, snapshot loaded, no banner). */
export async function openBoard(page, boardId) {
  await page.goto(`/b/${boardId}`);
  await expect(page.locator('section.list').first()).toBeVisible();
  await expect(page.getByText('Reconnecting…')).toHaveCount(0);
}

/** Mouse drag with @hello-pangea/dnd: press, nudge past the sloppy-click threshold, glide, drop. */
export async function dragCard(page, title, toList) {
  const card = page.locator('.list__cards > li', { hasText: title }).first();
  const target = column(page, toList).locator('.list__cards');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 4, { steps: 20 });
  await page.mouse.up();
  await expect(cardIn(page, toList, title)).toBeVisible();
}

/** Holds matching requests until `release()` is called (to force a deterministic race). */
export async function holdRequests(page, pattern) {
  let release;
  const gate = new Promise((r) => { release = r; });
  let held = 0;
  await page.route(pattern, async (route) => {
    held++;
    await gate;
    await route.continue();
  });
  return { release: () => release(), held: () => held };
}

/** Test-only: restart the e2e app server; optionally commit a change while everyone is offline. */
export async function restartServer(request, body = {}) {
  const res = await request.post('http://localhost:4101/restart', { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/**
 * The card modal's description, whether it's in edit mode (textarea) or preview mode (Markdown).
 * Headless pages all report document.hasFocus() === true, so typing in one browser can flip the
 * other's description into preview; the text is what matters.
 */
export function descriptionOf(page) {
  return page.evaluate(() => {
    const ta = document.querySelector('.card-modal__desc[aria-label="Description"]');
    if (ta) return ta.value;
    return document.querySelector('.card-modal__main .markdown')?.textContent?.trim() ?? null;
  });
}
