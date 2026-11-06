import { describe, it, expect, vi } from 'vitest';
import { applyOp, replay, DELETED } from './ops.js';
import { sendSerial, pendingKeys } from './sendSerial.js';

const c = { _id: 'a', listId: 'L1', position: 'a0', title: 'T', labelIds: ['x'], completed: false };

describe('applyOp', () => {
  it('handles every op type without mutating its input', () => {
    const frozen = Object.freeze({ ...c, labelIds: Object.freeze(['x']) });
    expect(applyOp(frozen, { type: 'move', toListId: 'L2', position: 'a5' })).toMatchObject({ listId: 'L2', position: 'a5' });
    expect(applyOp(frozen, { type: 'move', position: 'a5' })).toMatchObject({ listId: 'L1', position: 'a5' });
    expect(applyOp(frozen, { type: 'content', fields: { title: 'N' } }).title).toBe('N');
    expect(applyOp(frozen, { type: 'fields', set: { completed: true } }).completed).toBe(true);
    expect(applyOp(frozen, { type: 'addTo', key: 'labelIds', id: 'y' }).labelIds).toEqual(['x', 'y']);
    expect(applyOp(frozen, { type: 'addTo', key: 'labelIds', id: 'x' }).labelIds).toEqual(['x']);
    expect(applyOp(frozen, { type: 'pullFrom', key: 'labelIds', id: 'x' }).labelIds).toEqual([]);
    expect(applyOp(frozen, { type: 'delete' })).toBe(DELETED);
  });

  it('DELETED stays deleted; ops on a missing entity are no-ops; create makes it', () => {
    expect(applyOp(DELETED, { type: 'fields', set: { completed: true } })).toBe(DELETED);
    expect(applyOp(null, { type: 'fields', set: { completed: true } })).toBeNull();
    expect(applyOp(null, { type: 'create', entity: c })).toBe(c);
  });

  it('replay applies ops in order', () => {
    const ops = [{ op: { type: 'fields', set: { completed: true } } }, { op: { type: 'move', toListId: 'L2', position: 'b' } }];
    expect(replay(c, ops)).toMatchObject({ completed: true, listId: 'L2', position: 'b' });
  });
});

describe('sendSerial', () => {
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it('one request in flight per entity, even after a failure', async () => {
    const d1 = deferred();
    const second = vi.fn(async () => 'second');
    const p1 = sendSerial('a', () => d1.promise);
    const p2 = sendSerial('a', second);
    await Promise.resolve();
    expect(second).not.toHaveBeenCalled();
    d1.reject(new Error('boom'));
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('second');
  });

  it('different entities run in parallel; multi-key waits for all of them', async () => {
    const dA = deferred();
    const dB = deferred();
    const order = [];
    sendSerial('A', () => dA.promise.then(() => order.push('A')));
    const other = sendSerial('C', async () => order.push('C'));
    sendSerial('B', () => dB.promise.then(() => order.push('B')));
    const both = sendSerial(['A', 'B'], async () => order.push('AB'));
    await other;
    expect(order).toEqual(['C']);
    dB.resolve();
    await Promise.resolve();
    expect(order).not.toContain('AB');
    dA.resolve();
    await both;
    expect(order).toEqual(['C', 'B', 'A', 'AB']);
  });

  it('forgets idle chains', async () => {
    await sendSerial('idle', async () => 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingKeys()).not.toContain('idle');
  });
});
