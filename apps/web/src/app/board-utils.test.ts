import { describe, it, expect } from 'vitest';
import { computeElementDiff } from './board-utils';

describe('computeElementDiff', () => {
  it('returns empty ops for identical arrays', () => {
    const arr = [{ id: 'a', text: 'hello' }];
    const result = computeElementDiff(arr, [...arr]);
    expect(result.removes).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.inserts).toEqual([]);
  });

  it('returns empty ops for empty arrays', () => {
    const result = computeElementDiff([], []);
    expect(result.removes).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.inserts).toEqual([]);
  });

  it('detects element removal with back-to-front indices', () => {
    const current = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const next = [{ id: 'b' }];
    const result = computeElementDiff(current, next);
    expect(result.removes).toEqual([2, 0]);
    expect(result.sets).toEqual([]);
    expect(result.inserts).toEqual([]);
  });

  it('detects property changes', () => {
    const current = [{ id: 'a', text: 'old', color: 'red' }];
    const next = [{ id: 'a', text: 'new', color: 'red' }];
    const result = computeElementDiff(current, next);
    expect(result.removes).toEqual([]);
    expect(result.sets).toEqual([
      {
        index: 0,
        properties: { text: 'old' },
        newProperties: { text: 'new' },
      },
    ]);
    expect(result.inserts).toEqual([]);
  });

  it('detects property deletion as null in newProperties', () => {
    const current = [{ id: 'a', text: 'hello', extra: 'remove-me' }];
    const next = [{ id: 'a', text: 'hello' }];
    const result = computeElementDiff(current, next);
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0].newProperties.extra).toBeNull();
  });

  it('detects property addition', () => {
    const current = [{ id: 'a', text: 'hello' }];
    const next = [{ id: 'a', text: 'hello', color: 'blue' }];
    const result = computeElementDiff(current, next);
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0].newProperties).toEqual({ color: 'blue' });
    expect(result.sets[0].properties).toEqual({});
  });

  it('detects element insertion', () => {
    const current = [{ id: 'a' }];
    const next = [{ id: 'a' }, { id: 'b', text: 'new' }];
    const result = computeElementDiff(current, next);
    expect(result.removes).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.inserts).toEqual([
      { index: 1, element: { id: 'b', text: 'new' } },
    ]);
  });

  it('handles all inserts from empty', () => {
    const next = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = computeElementDiff([], next);
    expect(result.removes).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.inserts).toHaveLength(3);
    expect(result.inserts.map((i) => i.element.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles all removes to empty', () => {
    const current = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = computeElementDiff(current, []);
    expect(result.removes).toEqual([2, 1, 0]);
    expect(result.sets).toEqual([]);
    expect(result.inserts).toEqual([]);
  });

  it('handles complex mixed changes (remove + modify + insert)', () => {
    const current = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ];
    const next = [
      { id: 'a', text: 'A-modified' },
      { id: 'd', text: 'D' },
      { id: 'c', text: 'C' },
    ];
    const result = computeElementDiff(current, next);
    // b removed (index 1 in original)
    expect(result.removes).toEqual([1]);
    // a modified (index 0 in post-remove [a, c])
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0].index).toBe(0);
    expect(result.sets[0].newProperties.text).toBe('A-modified');
    // d inserted at index 1
    expect(result.inserts).toEqual([
      { index: 1, element: { id: 'd', text: 'D' } },
    ]);
  });

  it('handles deep object property changes', () => {
    const current = [{ id: 'a', children: [{ text: 'old' }] }];
    const next = [{ id: 'a', children: [{ text: 'new' }] }];
    const result = computeElementDiff(current, next);
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0].newProperties.children).toEqual([{ text: 'new' }]);
  });

  it('preserves insert order for multiple new elements', () => {
    const current = [{ id: 'a' }];
    const next = [{ id: 'x' }, { id: 'a' }, { id: 'y' }];
    const result = computeElementDiff(current, next);
    expect(result.inserts).toHaveLength(2);
    expect(result.inserts[0]).toEqual({ index: 0, element: { id: 'x' } });
    expect(result.inserts[1]).toEqual({ index: 2, element: { id: 'y' } });
  });
});
