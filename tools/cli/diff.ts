import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveVyncPath } from './resolve.js';

// --- Types ---

interface FlatNode {
  id: string;
  text: string;
  parentId: string | null;
  type: string;
  childIds: string[];
}

interface DiffChange {
  kind: 'added' | 'removed' | 'modified' | 'moved';
  id: string;
  text: string;
  detail: string;
  semanticHint?: string;
}

type VizType = 'mindmap' | 'flowchart' | 'generic';

export interface DiffResult {
  filePath: string;
  tree: string;
  changes: DiffChange[];
  hasChanges: boolean;
  snapshotUpdated: boolean;
}

// --- Helper: extract text from element ---

function extractText(el: Record<string, unknown>): string {
  // Mindmap: data.topic.children[0].text
  const data = el.data as Record<string, unknown> | undefined;
  if (data) {
    const topic = data.topic as Record<string, unknown> | undefined;
    if (topic) {
      const children = topic.children as Array<{ text?: string }> | undefined;
      if (children && children.length > 0 && children[0].text) {
        return children[0].text;
      }
    }
  }
  // Geometry/Arrow: text.children[0].text
  const text = el.text as Record<string, unknown> | undefined;
  if (text) {
    const children = text.children as Array<{ text?: string }> | undefined;
    if (children && children.length > 0 && children[0].text) {
      return children[0].text;
    }
  }
  return '';
}

// --- Helper: flatten elements recursively ---

function flattenElements(
  elements: Record<string, unknown>[],
  parentId: string | null,
  map: Map<string, FlatNode>
): void {
  for (const el of elements) {
    const id = el.id as string;
    if (!id) continue;

    const text = extractText(el);
    const type = (el.type as string) || 'unknown';
    const children = (el.children as Record<string, unknown>[]) || [];
    const childIds = children.map((c) => c.id as string).filter(Boolean);

    map.set(id, { id, text, parentId, type, childIds });

    if (children.length > 0) {
      flattenElements(children, id, map);
    }
  }
}

// --- Helper: build tree string ---

function buildTreeString(
  elements: Record<string, unknown>[],
  indent: string = '',
  isLast: boolean[] = []
): string {
  const lines: string[] = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const text = extractText(el);
    const children = (el.children as Record<string, unknown>[]) || [];
    const last = i === elements.length - 1;

    if (indent === '') {
      // Root level
      lines.push(`  ${text}`);
    } else {
      const prefix = indent + (last ? '└── ' : '├── ');
      lines.push(prefix + text);
    }

    if (children.length > 0) {
      const childIndent =
        indent === '' ? '  ' : indent + (last ? '    ' : '│   ');
      lines.push(buildTreeString(children, childIndent, [...isLast, last]));
    }
  }

  return lines.join('\n');
}

// --- Helper: find parent text ---

function findParentText(
  map: Map<string, FlatNode>,
  parentId: string | null
): string {
  if (!parentId) return 'root';
  const parent = map.get(parentId);
  return parent ? parent.text : parentId;
}

// --- Core: compute diff ---

export function computeDiff(
  currentElements: Record<string, unknown>[],
  snapshotElements: Record<string, unknown>[]
): DiffChange[] {
  const currentMap = new Map<string, FlatNode>();
  const snapshotMap = new Map<string, FlatNode>();

  flattenElements(currentElements, null, currentMap);
  flattenElements(snapshotElements, null, snapshotMap);

  const changes: DiffChange[] = [];

  // Added: in current but not in snapshot
  for (const [id, node] of currentMap) {
    if (!snapshotMap.has(id)) {
      const parentText = findParentText(currentMap, node.parentId);
      changes.push({
        kind: 'added',
        id,
        text: node.text,
        detail: `Added: ${node.text} (under ${parentText})`,
      });
    }
  }

  // Removed: in snapshot but not in current
  for (const [id, node] of snapshotMap) {
    if (!currentMap.has(id)) {
      const parentText = findParentText(snapshotMap, node.parentId);
      changes.push({
        kind: 'removed',
        id,
        text: node.text,
        detail: `Removed: ${node.text} (was under ${parentText})`,
      });
    }
  }

  // Modified & Moved: same ID in both
  for (const [id, current] of currentMap) {
    const snapshot = snapshotMap.get(id);
    if (!snapshot) continue;

    // Text modified
    if (current.text !== snapshot.text) {
      changes.push({
        kind: 'modified',
        id,
        text: current.text,
        detail: `Modified: "${snapshot.text}" → "${current.text}"`,
      });
    }

    // Parent changed (moved)
    if (current.parentId !== snapshot.parentId) {
      const fromParent = findParentText(snapshotMap, snapshot.parentId);
      const toParent = findParentText(currentMap, current.parentId);
      changes.push({
        kind: 'moved',
        id,
        text: current.text,
        detail: `Moved: ${current.text} — ${fromParent} → ${toParent}`,
      });
    }
  }

  return changes;
}

// --- Visualization type detection (S-1: file-level) ---

export function detectVizType(elements: Record<string, unknown>[]): VizType {
  if (elements.length === 0) return 'generic';

  const rootType = elements[0].type as string | undefined;
  if (rootType === 'mindmap') return 'mindmap';

  // Geometry with arrow-lines → flowchart
  if (rootType === 'geometry') {
    const hasArrow = elements.some(
      (el) => (el.type as string) === 'arrow-line'
    );
    return hasArrow ? 'flowchart' : 'generic';
  }

  return 'generic';
}

// --- Semantic hint enrichment (S-4: separated from computeDiff) ---

export function enrichWithSemanticHints(
  changes: DiffChange[],
  vizType: VizType,
  currentElements: Record<string, unknown>[],
  snapshotElements: Record<string, unknown>[]
): DiffChange[] {
  if (vizType === 'generic' || vizType === 'flowchart') return changes;

  // Build maps for parent lookup
  const currentMap = new Map<string, FlatNode>();
  const snapshotMap = new Map<string, FlatNode>();
  flattenElements(currentElements, null, currentMap);
  flattenElements(snapshotElements, null, snapshotMap);

  // S-2: Detect multi-moved grouping pattern first
  const movedChanges = changes.filter((c) => c.kind === 'moved');
  const groupedByTarget = new Map<string, DiffChange[]>();
  for (const mc of movedChanges) {
    const node = currentMap.get(mc.id);
    const parentKey = node?.parentId ?? 'root';
    const existing = groupedByTarget.get(parentKey) || [];
    existing.push(mc);
    groupedByTarget.set(parentKey, existing);
  }

  // Find groups of 2+ moved to same parent
  const groupedIds = new Set<string>();
  const groupHints = new Map<string, string>(); // changeId → group hint
  for (const [parentKey, group] of groupedByTarget) {
    if (group.length >= 2) {
      const toParentText = findParentText(
        currentMap,
        parentKey === 'root' ? null : parentKey
      );
      const texts = group.map((c) => c.text).join(', ');
      const hint = `그룹화: [${texts}]가 ${toParentText} 하위로 통합`;
      for (const c of group) {
        groupedIds.add(c.id);
        groupHints.set(c.id, hint);
      }
    }
  }

  return changes.map((change) => {
    let semanticHint: string | undefined;

    if (groupedIds.has(change.id)) {
      semanticHint = groupHints.get(change.id);
    } else if (change.kind === 'moved') {
      const snapshot = snapshotMap.get(change.id);
      const current = currentMap.get(change.id);
      if (snapshot && current) {
        const fromParent = findParentText(snapshotMap, snapshot.parentId);
        const toParent = findParentText(currentMap, current.parentId);
        if (!current.parentId) {
          semanticHint = `독립화: ${change.text}가 ${fromParent}에서 분리되어 독립 개념으로`;
        } else if (!snapshot.parentId) {
          semanticHint = `위계 변경: ${change.text}가 ${toParent}의 하위 개념으로 재분류됨`;
        } else {
          semanticHint = `재분류: ${change.text}가 ${fromParent}가 아닌 ${toParent}의 하위로`;
        }
      }
    } else if (change.kind === 'added') {
      const node = currentMap.get(change.id);
      const parentText = findParentText(currentMap, node?.parentId ?? null);
      semanticHint = `개념 추가: ${change.text}가 ${parentText}의 새 하위 요소로`;
    } else if (change.kind === 'removed') {
      const node = snapshotMap.get(change.id);
      const parentText = findParentText(snapshotMap, node?.parentId ?? null);
      semanticHint = `개념 제거: ${change.text}가 ${parentText}에서 삭제됨`;
    } else if (change.kind === 'modified') {
      // detail already has "Modified: "old" → "new""
      const snapshot = snapshotMap.get(change.id);
      semanticHint = `재정의: ${snapshot?.text ?? '?'} → ${change.text}`;
    }

    return semanticHint ? { ...change, semanticHint } : change;
  });
}

// --- CLI entry point ---

export async function vyncDiff(
  filePath: string,
  options: { noSnapshot?: boolean } = {}
): Promise<DiffResult> {
  const resolved = resolveVyncPath(filePath);
  const snapshotPath = resolved + '.lastread';
  const fileName = path.basename(resolved);

  // Read current .vync file
  let currentRaw: string;
  try {
    currentRaw = await fs.readFile(resolved, 'utf-8');
  } catch {
    throw new Error(`File not found: ${resolved}`);
  }

  const currentData = JSON.parse(currentRaw);

  // Guard: graph files are not yet supported by diff
  if (currentData.type === 'graph') {
    return {
      filePath: resolved,
      tree: `[${fileName}] Graph files are not yet supported by diff`,
      changes: [],
      hasChanges: false,
      snapshotUpdated: false,
    };
  }

  const currentElements = currentData.elements || [];

  // Build tree from current state
  const tree = buildTreeString(currentElements);

  // Check snapshot
  let snapshotExists = false;
  let snapshotElements: Record<string, unknown>[] = [];
  try {
    const snapshotRaw = await fs.readFile(snapshotPath, 'utf-8');
    const snapshotData = JSON.parse(snapshotRaw);
    snapshotElements = snapshotData.elements || [];
    snapshotExists = true;
  } catch {
    // No snapshot — first diff
  }

  // Compute changes
  let changes: DiffChange[] = [];
  if (snapshotExists) {
    changes = computeDiff(currentElements, snapshotElements);
    const vizType = detectVizType(currentElements);
    changes = enrichWithSemanticHints(
      changes,
      vizType,
      currentElements,
      snapshotElements
    );
  }

  // Update snapshot (unless --no-snapshot)
  if (!options.noSnapshot) {
    await fs.writeFile(snapshotPath, currentRaw, 'utf-8');
  }

  return {
    filePath: resolved,
    tree,
    changes,
    hasChanges: changes.length > 0,
    snapshotUpdated: !options.noSnapshot,
  };
}

// --- Format output ---

export function formatDiffResult(result: DiffResult): string {
  const fileName = path.basename(result.filePath);
  const lines: string[] = [];

  lines.push(`=== Vync Diff: ${fileName} ===`);
  lines.push('');
  lines.push('현재 구조:');
  if (result.tree) {
    lines.push(result.tree);
  } else {
    lines.push('  (empty)');
  }

  lines.push('');
  if (result.changes.length > 0) {
    lines.push('변경사항:');
    for (const change of result.changes) {
      lines.push(`  ${change.detail}`);
      if (change.semanticHint) {
        lines.push(`    → ${change.semanticHint}`);
      }
    }
  } else {
    lines.push('변경사항: 없음');
  }

  if (result.snapshotUpdated) {
    lines.push('');
    lines.push('Snapshot updated.');
  }

  return lines.join('\n');
}
