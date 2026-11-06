import { describe, it, expect } from 'vitest';
import { parseFilters, writeFilters, matches, isActive, NO_FILTERS } from './filters.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const at = (days) => new Date(NOW + days * 24 * 3600 * 1000).toISOString();
const card = (extra = {}) => ({
  title: 'Fix login bug', description: 'Users see a **500**', assigneeIds: ['u1'], labelIds: ['red'],
  dueDate: null, completed: false, ...extra,
});
const f = (extra) => ({ ...NO_FILTERS, ...extra });

describe('URL round trip', () => {
  it('parses and writes, keeping unrelated params', () => {
    const params = new URLSearchParams('q=bug&m=u1,u2&l=red&due=overdue&other=1');
    const parsed = parseFilters(params);
    expect(parsed).toEqual({ text: 'bug', memberIds: ['u1', 'u2'], labelIds: ['red'], due: 'overdue' });
    expect(Object.fromEntries(writeFilters(params, parsed))).toEqual({ q: 'bug', m: 'u1,u2', l: 'red', due: 'overdue', other: '1' });
    expect(writeFilters(params, NO_FILTERS).toString()).toBe('other=1');
  });

  it('no or bogus params → the shared NO_FILTERS object (stable reference)', () => {
    expect(parseFilters(new URLSearchParams(''))).toBe(NO_FILTERS);
    expect(parseFilters(new URLSearchParams('due=someday'))).toBe(NO_FILTERS);
    expect(isActive(NO_FILTERS)).toBe(false);
  });
});

describe('matches', () => {
  it('text: case-insensitive, title or description', () => {
    expect(matches(card(), f({ text: 'LOGIN' }))).toBe(true);
    expect(matches(card(), f({ text: '500' }))).toBe(true);
    expect(matches(card(), f({ text: 'payment' }))).toBe(false);
  });

  it('members and labels: any of the selected; criteria combine with AND', () => {
    expect(matches(card(), f({ memberIds: ['u9', 'u1'] }))).toBe(true);
    expect(matches(card(), f({ memberIds: ['u9'] }))).toBe(false);
    expect(matches(card(), f({ labelIds: ['red'], memberIds: ['u9'] }))).toBe(false);
  });

  it('due: overdue / this week / none', () => {
    expect(matches(card({ dueDate: at(-1) }), f({ due: 'overdue' }), NOW)).toBe(true);
    expect(matches(card({ dueDate: at(-1), completed: true }), f({ due: 'overdue' }), NOW)).toBe(false);
    expect(matches(card({ dueDate: at(3) }), f({ due: 'week' }), NOW)).toBe(true);
    expect(matches(card({ dueDate: at(10) }), f({ due: 'week' }), NOW)).toBe(false);
    expect(matches(card(), f({ due: 'none' }), NOW)).toBe(true);
    expect(matches(card({ dueDate: at(1) }), f({ due: 'none' }), NOW)).toBe(false);
  });
});
