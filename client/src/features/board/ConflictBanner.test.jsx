// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConflictBanner } from './ConflictBanner.jsx';

afterEach(cleanup);

const conflict = { fields: ['description'], current: { title: 'T', description: 'theirs', version: 5 } };

function setup(props = {}) {
  const handlers = { onTheirs: vi.fn(), onMine: vi.fn(), onCopy: vi.fn() };
  render(<ConflictBanner conflict={conflict} byName="Alice" {...handlers} {...props} />);
  return handlers;
}

describe('ConflictBanner', () => {
  it('says who changed which field', () => {
    setup();
    expect(screen.getByRole('alert').textContent).toContain('Alice changed the description while you were editing');
  });

  it.each([
    ['Use theirs', 'onTheirs'],
    ['Keep mine', 'onMine'],
    ['Copy mine', 'onCopy'],
  ])('"%s" calls %s and nothing else', (label, handler) => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: label }));
    for (const [name, fn] of Object.entries(handlers)) expect(fn).toHaveBeenCalledTimes(name === handler ? 1 : 0);
  });

  it('falls back to "Someone" and names both fields', () => {
    setup({ byName: null, conflict: { ...conflict, fields: ['title', 'description'] } });
    expect(screen.getByRole('alert').textContent).toContain('Someone changed the title and the description');
  });
});
