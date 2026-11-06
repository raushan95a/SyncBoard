import { describe, it, expect } from 'vitest';
import { dueState, toLocalInput, fromLocalInput } from './cardUtils.js';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const at = (h) => new Date(NOW + h * 3600 * 1000).toISOString();

describe('dueState', () => {
  it('maps due dates to chip colors', () => {
    expect(dueState({ dueDate: null }, NOW)).toBeNull();
    expect(dueState({ dueDate: at(-1), completed: false }, NOW)).toBe('overdue');
    expect(dueState({ dueDate: at(5), completed: false }, NOW)).toBe('soon');
    expect(dueState({ dueDate: at(48), completed: false }, NOW)).toBe('later');
    expect(dueState({ dueDate: at(-1), completed: true }, NOW)).toBe('done');
  });
});

describe('datetime-local conversion', () => {
  it('round-trips through local time without drifting', () => {
    const iso = '2026-12-01T09:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('clears to null', () => {
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
  });
});
