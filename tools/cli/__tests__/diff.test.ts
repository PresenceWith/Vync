import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  computeDiff,
  vyncDiff,
  formatDiffResult,
  detectVizType,
  enrichWithSemanticHints,
} from '../diff.js';

// --- Helper: build mindmap element ---

function mindmapEl(
  id: string,
  text: string,
  children: Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    type: children.length === 0 && !extra.isRoot ? 'mind_child' : 'mindmap',
    data: { topic: { children: [{ text }] } },
    children,
    ...extra,
  };
}

function childEl(
  id: string,
  text: string,
  children: Record<string, unknown>[] = []
): Record<string, unknown> {
  return {
    id,
    type: 'mind_child',
    data: { topic: { children: [{ text }] } },
    children,
  };
}

function vyncFile(elements: Record<string, unknown>[]): string {
  return JSON.stringify(
    { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements },
    null,
    2
  );
}

// --- computeDiff tests ---

describe('computeDiff', () => {
  it('detects no changes when elements are identical', () => {
    const elements = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], { isRoot: true }),
    ];
    const changes = computeDiff(elements, elements);
    expect(changes).toEqual([]);
  });

  it('detects added nodes', () => {
    const snapshot = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], {
        isRoot: true,
      }),
    ];
    const current = [
      mindmapEl(
        'root',
        'Project',
        [childEl('a', 'Design'), childEl('b', 'Dev')],
        { isRoot: true }
      ),
    ];
    const changes = computeDiff(current, snapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('added');
    expect(changes[0].text).toBe('Dev');
    expect(changes[0].detail).toContain('under Project');
  });

  it('detects removed nodes', () => {
    const snapshot = [
      mindmapEl(
        'root',
        'Project',
        [childEl('a', 'Design'), childEl('b', 'Dev')],
        { isRoot: true }
      ),
    ];
    const current = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], {
        isRoot: true,
      }),
    ];
    const changes = computeDiff(current, snapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('removed');
    expect(changes[0].text).toBe('Dev');
    expect(changes[0].detail).toContain('was under Project');
  });

  it('detects modified text', () => {
    const snapshot = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], {
        isRoot: true,
      }),
    ];
    const current = [
      mindmapEl('root', 'Project', [childEl('a', 'Architecture')], {
        isRoot: true,
      }),
    ];
    const changes = computeDiff(current, snapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('modified');
    expect(changes[0].detail).toContain('"Design" → "Architecture"');
  });

  it('detects moved nodes (parent changed)', () => {
    const snapshot = [
      mindmapEl(
        'root',
        'Project',
        [childEl('a', 'Design', [childEl('c', 'UX')]), childEl('b', 'Dev')],
        { isRoot: true }
      ),
    ];
    // Move UX from Design to Dev
    const current = [
      mindmapEl(
        'root',
        'Project',
        [childEl('a', 'Design'), childEl('b', 'Dev', [childEl('c', 'UX')])],
        { isRoot: true }
      ),
    ];
    const changes = computeDiff(current, snapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('moved');
    expect(changes[0].detail).toContain('Design → Dev');
  });

  it('detects multiple change types at once', () => {
    const snapshot = [
      mindmapEl(
        'root',
        'Project',
        [childEl('a', 'Design'), childEl('b', 'Dev'), childEl('c', 'Test')],
        { isRoot: true }
      ),
    ];
    const current = [
      mindmapEl(
        'root',
        'Project',
        [
          childEl('a', 'UI Design'), // modified
          // b removed
          childEl('c', 'Test'),
          childEl('d', 'Deploy'), // added
        ],
        { isRoot: true }
      ),
    ];
    const changes = computeDiff(current, snapshot);
    const kinds = changes.map((c) => c.kind);
    expect(kinds).toContain('added');
    expect(kinds).toContain('removed');
    expect(kinds).toContain('modified');
  });

  it('handles geometry elements with text field', () => {
    const snapshot = [
      {
        id: 'g1',
        type: 'geometry',
        shape: 'rectangle',
        text: { children: [{ text: 'Start' }] },
        points: [
          [0, 0],
          [100, 50],
        ],
        children: [],
      },
    ];
    const current = [
      {
        id: 'g1',
        type: 'geometry',
        shape: 'rectangle',
        text: { children: [{ text: 'Begin' }] },
        points: [
          [0, 0],
          [100, 50],
        ],
        children: [],
      },
    ];
    const changes = computeDiff(current, snapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('modified');
    expect(changes[0].detail).toContain('"Start" → "Begin"');
  });

  it('returns empty changes for empty elements', () => {
    const changes = computeDiff([], []);
    expect(changes).toEqual([]);
  });
});

// --- vyncDiff integration tests ---

describe('vyncDiff', () => {
  const tmpDir = path.join(os.tmpdir(), 'vync-test-diff');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpDir;
  });

  afterEach(async () => {
    delete process.env.VYNC_CALLER_CWD;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns tree structure with no changes for first diff', async () => {
    const elements = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], {
        isRoot: true,
        width: 100,
        height: 50,
        points: [[0, 0]],
      }),
    ];
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, vyncFile(elements));

    const result = await vyncDiff(filePath);

    expect(result.tree).toContain('Project');
    expect(result.tree).toContain('Design');
    expect(result.changes).toEqual([]);
    expect(result.hasChanges).toBe(false);
  });

  it('creates snapshot on first diff', async () => {
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, vyncFile([]));

    await vyncDiff(filePath);

    const snapshotExists = await fs
      .access(filePath + '.lastread')
      .then(() => true)
      .catch(() => false);
    expect(snapshotExists).toBe(true);
  });

  it('detects changes between snapshot and current', async () => {
    const filePath = path.join(tmpDir, 'test.vync');

    // Write initial version and create snapshot
    const v1 = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], {
        isRoot: true,
      }),
    ];
    await fs.writeFile(filePath, vyncFile(v1));
    await vyncDiff(filePath); // creates snapshot

    // Modify file (simulate browser edit)
    const v2 = [
      mindmapEl(
        'root',
        'Project',
        [childEl('a', 'Design'), childEl('b', 'Dev')],
        { isRoot: true }
      ),
    ];
    await fs.writeFile(filePath, vyncFile(v2));

    // Diff again
    const result = await vyncDiff(filePath);
    expect(result.hasChanges).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe('added');
    expect(result.changes[0].text).toBe('Dev');
  });

  it('respects --no-snapshot option', async () => {
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, vyncFile([]));

    await vyncDiff(filePath, { noSnapshot: true });

    const snapshotExists = await fs
      .access(filePath + '.lastread')
      .then(() => true)
      .catch(() => false);
    expect(snapshotExists).toBe(false);
  });

  it('throws for non-existent file', async () => {
    await expect(vyncDiff(path.join(tmpDir, 'nope.vync'))).rejects.toThrow(
      'File not found'
    );
  });
});

// --- formatDiffResult tests ---

describe('formatDiffResult', () => {
  it('formats output with changes', () => {
    const output = formatDiffResult({
      filePath: '/path/to/plan.vync',
      tree: '  Project\n  ├── Design\n  └── Dev',
      changes: [
        {
          kind: 'added',
          id: 'b',
          text: 'Dev',
          detail: 'Added: Dev (under Project)',
        },
      ],
      hasChanges: true,
      snapshotUpdated: true,
    });

    expect(output).toContain('=== Vync Diff: plan.vync ===');
    expect(output).toContain('현재 구조:');
    expect(output).toContain('Project');
    expect(output).toContain('변경사항:');
    expect(output).toContain('Added: Dev (under Project)');
    expect(output).toContain('Snapshot updated.');
  });

  it('formats output with no changes', () => {
    const output = formatDiffResult({
      filePath: '/path/to/plan.vync',
      tree: '  Project',
      changes: [],
      hasChanges: false,
      snapshotUpdated: true,
    });

    expect(output).toContain('변경사항: 없음');
  });

  it('omits snapshot message when --no-snapshot', () => {
    const output = formatDiffResult({
      filePath: '/path/to/plan.vync',
      tree: '  Project',
      changes: [],
      hasChanges: false,
      snapshotUpdated: false,
    });

    expect(output).not.toContain('Snapshot updated.');
  });
});

// --- detectVizType tests ---

describe('detectVizType', () => {
  it('returns mindmap for mindmap root element', () => {
    const elements = [
      mindmapEl('root', 'Project', [childEl('a', 'Design')], {
        isRoot: true,
      }),
    ];
    expect(detectVizType(elements)).toBe('mindmap');
  });

  it('returns flowchart for geometry with arrow-line', () => {
    const elements = [
      {
        id: 'g1',
        type: 'geometry',
        shape: 'rectangle',
        text: { children: [{ text: 'Start' }] },
        children: [],
      },
      {
        id: 'a1',
        type: 'arrow-line',
        children: [],
      },
    ];
    expect(detectVizType(elements)).toBe('flowchart');
  });

  it('returns generic for geometry without arrow-line', () => {
    const elements = [
      {
        id: 'g1',
        type: 'geometry',
        shape: 'rectangle',
        text: { children: [{ text: 'Box' }] },
        children: [],
      },
    ];
    expect(detectVizType(elements)).toBe('generic');
  });

  it('returns generic for empty elements', () => {
    expect(detectVizType([])).toBe('generic');
  });

  it('returns generic for unknown type', () => {
    const elements = [{ id: 'x', type: 'custom', children: [] }];
    expect(detectVizType(elements)).toBe('generic');
  });
});

// --- enrichWithSemanticHints tests ---

describe('enrichWithSemanticHints', () => {
  it('adds hint for moved node (to child — 위계 변경)', () => {
    // "리서치" was under root, now under "기획"
    const snapshot = [
      mindmapEl(
        'root',
        '프로젝트',
        [childEl('a', '기획'), childEl('b', '리서치')],
        { isRoot: true }
      ),
    ];
    const current = [
      mindmapEl(
        'root',
        '프로젝트',
        [childEl('a', '기획', [childEl('b', '리서치')])],
        { isRoot: true }
      ),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'mindmap',
      current,
      snapshot
    );

    expect(enriched).toHaveLength(1);
    expect(enriched[0].kind).toBe('moved');
    expect(enriched[0].semanticHint).toContain('재분류');
    expect(enriched[0].semanticHint).toContain('리서치');
    expect(enriched[0].semanticHint).toContain('기획');
  });

  it('adds hint for moved node to root (독립화)', () => {
    const snapshot = [
      mindmapEl(
        'root',
        '프로젝트',
        [childEl('a', '기획', [childEl('b', '리서치')])],
        { isRoot: true }
      ),
    ];
    const current = [
      mindmapEl('root', '프로젝트', [childEl('a', '기획')], { isRoot: true }),
      {
        id: 'b',
        type: 'mindmap',
        data: { topic: { children: [{ text: '리서치' }] } },
        children: [],
      },
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'mindmap',
      current,
      snapshot
    );

    const moved = enriched.find((c) => c.kind === 'moved');
    expect(moved).toBeDefined();
    expect(moved!.semanticHint).toContain('독립화');
    expect(moved!.semanticHint).toContain('리서치');
  });

  it('adds hint for added node', () => {
    const snapshot = [
      mindmapEl('root', '프로젝트', [childEl('a', '기획')], { isRoot: true }),
    ];
    const current = [
      mindmapEl(
        'root',
        '프로젝트',
        [childEl('a', '기획'), childEl('b', '개발')],
        { isRoot: true }
      ),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'mindmap',
      current,
      snapshot
    );

    expect(enriched).toHaveLength(1);
    expect(enriched[0].semanticHint).toContain('개념 추가');
    expect(enriched[0].semanticHint).toContain('개발');
    expect(enriched[0].semanticHint).toContain('프로젝트');
  });

  it('adds hint for removed node', () => {
    const snapshot = [
      mindmapEl(
        'root',
        '프로젝트',
        [childEl('a', '기획'), childEl('b', '개발')],
        { isRoot: true }
      ),
    ];
    const current = [
      mindmapEl('root', '프로젝트', [childEl('a', '기획')], { isRoot: true }),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'mindmap',
      current,
      snapshot
    );

    expect(enriched).toHaveLength(1);
    expect(enriched[0].semanticHint).toContain('개념 제거');
    expect(enriched[0].semanticHint).toContain('개발');
  });

  it('adds hint for modified text', () => {
    const snapshot = [
      mindmapEl('root', '프로젝트', [childEl('a', '설계')], { isRoot: true }),
    ];
    const current = [
      mindmapEl('root', '프로젝트', [childEl('a', '아키텍처')], {
        isRoot: true,
      }),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'mindmap',
      current,
      snapshot
    );

    expect(enriched).toHaveLength(1);
    expect(enriched[0].semanticHint).toContain('재정의');
    expect(enriched[0].semanticHint).toContain('설계');
    expect(enriched[0].semanticHint).toContain('아키텍처');
  });

  it('detects multi-moved grouping (S-2)', () => {
    // Move "인터뷰" and "설문" under "리서치"
    const snapshot = [
      mindmapEl(
        'root',
        '프로젝트',
        [childEl('a', '리서치'), childEl('b', '인터뷰'), childEl('c', '설문')],
        { isRoot: true }
      ),
    ];
    const current = [
      mindmapEl(
        'root',
        '프로젝트',
        [
          childEl('a', '리서치', [
            childEl('b', '인터뷰'),
            childEl('c', '설문'),
          ]),
        ],
        { isRoot: true }
      ),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'mindmap',
      current,
      snapshot
    );

    // Both should have the same grouping hint
    expect(enriched).toHaveLength(2);
    expect(enriched[0].semanticHint).toContain('그룹화');
    expect(enriched[0].semanticHint).toContain('인터뷰');
    expect(enriched[0].semanticHint).toContain('설문');
    expect(enriched[0].semanticHint).toContain('리서치');
    expect(enriched[0].semanticHint).toBe(enriched[1].semanticHint);
  });

  it('skips hints for generic viz type', () => {
    const snapshot = [
      mindmapEl('root', 'Project', [childEl('a', 'A')], { isRoot: true }),
    ];
    const current = [
      mindmapEl('root', 'Project', [childEl('a', 'A'), childEl('b', 'B')], {
        isRoot: true,
      }),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'generic',
      current,
      snapshot
    );

    expect(enriched).toHaveLength(1);
    expect(enriched[0].semanticHint).toBeUndefined();
  });

  it('skips hints for flowchart viz type', () => {
    const snapshot = [
      mindmapEl('root', 'Project', [childEl('a', 'A')], { isRoot: true }),
    ];
    const current = [
      mindmapEl('root', 'Project', [childEl('a', 'A'), childEl('b', 'B')], {
        isRoot: true,
      }),
    ];
    const changes = computeDiff(current, snapshot);
    const enriched = enrichWithSemanticHints(
      changes,
      'flowchart',
      current,
      snapshot
    );

    expect(enriched).toHaveLength(1);
    expect(enriched[0].semanticHint).toBeUndefined();
  });
});

// --- formatDiffResult with semantic hints ---

describe('formatDiffResult with semanticHint', () => {
  it('includes hint line after change detail', () => {
    const output = formatDiffResult({
      filePath: '/path/to/plan.vync',
      tree: '  프로젝트\n  └── 기획\n      └── 리서치',
      changes: [
        {
          kind: 'moved',
          id: 'b',
          text: '리서치',
          detail: 'Moved: 리서치 — 프로젝트 → 기획',
          semanticHint: '위계 변경: 리서치가 기획의 하위 개념으로 재분류됨',
        },
      ],
      hasChanges: true,
      snapshotUpdated: true,
    });

    expect(output).toContain('Moved: 리서치 — 프로젝트 → 기획');
    expect(output).toContain(
      '→ 위계 변경: 리서치가 기획의 하위 개념으로 재분류됨'
    );
  });

  it('omits hint line when no semanticHint', () => {
    const output = formatDiffResult({
      filePath: '/path/to/plan.vync',
      tree: '  Project',
      changes: [
        {
          kind: 'added',
          id: 'b',
          text: 'Dev',
          detail: 'Added: Dev (under Project)',
        },
      ],
      hasChanges: true,
      snapshotUpdated: true,
    });

    expect(output).toContain('Added: Dev (under Project)');
    expect(output).not.toContain('→');
  });
});
