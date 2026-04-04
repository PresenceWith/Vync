export interface DiffOps {
  removes: number[];
  sets: {
    index: number;
    properties: Record<string, unknown>;
    newProperties: Record<string, unknown>;
  }[];
  inserts: {
    index: number;
    element: { id: string; [key: string]: unknown };
  }[];
}

type Element = { id: string; [key: string]: unknown };

/**
 * Compute the diff operations needed to transform `current` into `next`.
 * Returns removes (back-to-front indices), sets (property changes), and inserts (new elements).
 */
export function computeElementDiff(
  current: Element[],
  next: Element[]
): DiffOps {
  const newById = new Map(next.map((el) => [el.id, el]));
  const newIds = new Set(next.map((el) => el.id));

  // Phase 1: removes (back-to-front)
  const removes: number[] = [];
  for (let i = current.length - 1; i >= 0; i--) {
    if (!newIds.has(current[i].id)) {
      removes.push(i);
    }
  }

  // Simulate removal to get post-remove state
  const afterRemove = current.filter((el) => newIds.has(el.id));

  // Phase 2: sets (property changes)
  const sets: DiffOps['sets'] = [];
  for (let i = 0; i < afterRemove.length; i++) {
    const cur = afterRemove[i];
    const target = newById.get(cur.id);
    if (!target) continue;
    const properties: Record<string, unknown> = {};
    const newProperties: Record<string, unknown> = {};
    const allKeys = new Set([...Object.keys(cur), ...Object.keys(target)]);
    for (const key of allKeys) {
      if (key === 'id') continue;
      const curVal = cur[key];
      const newVal = target[key];
      if (JSON.stringify(curVal) !== JSON.stringify(newVal)) {
        if (curVal !== undefined) properties[key] = curVal;
        newProperties[key] = newVal !== undefined ? newVal : null;
      }
    }
    if (Object.keys(newProperties).length > 0) {
      sets.push({ index: i, properties, newProperties });
    }
  }

  // Phase 3: inserts
  const currentIds = new Set(afterRemove.map((el) => el.id));
  const inserts: DiffOps['inserts'] = [];
  for (let i = 0; i < next.length; i++) {
    if (!currentIds.has(next[i].id)) {
      inserts.push({ index: i, element: next[i] });
      currentIds.add(next[i].id);
    }
  }

  return { removes, sets, inserts };
}
