# Graph View Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully-synced ontology/knowledge graph editor to Vync — `type: "graph"` files use React Flow for rendering and ELK.js for auto-layout, sharing the existing real-time sync pipeline with canvas files.

**Architecture:** Extend VyncFile to a discriminated union (`VyncCanvasFile | VyncGraphFile`). GraphView mirrors FileBoard's sync pattern (GET → WS → debounced PUT) but uses React Flow controlled state. App.tsx routes to GraphView or FileBoard based on `data.type`. CLI `vync init` gains `--type graph` option.

**Tech Stack:** React Flow v12 (`@xyflow/react`), ELK.js (`elkjs/lib/elk.bundled.js`), React 19, TypeScript, Vitest

**Spec:** `docs/plans/2026-03-14-graph-view-proposal.md`
**PoC Results:** `docs/plans/2026-03-14-graph-view-poc.md` (11/11 PASS, Go)
**PoC Code:** Already on `develop` — GraphView.tsx skeleton, server.ts type branch, diff.ts guard, hook guard

---

## Scope

This plan covers the **core graph view** — a working, synced graph editor with CRUD and auto-layout. It does NOT cover:
- Property inspector panel (§5 of proposal — separate plan)
- diff.ts graph mode (separate plan)
- vync-translator graph support (separate plan)
- Undo/redo (separate plan)
- Export formats (JSON-LD, RDF — future)

These are listed in proposal §7 "기능 통합" and will be separate plans.

**Known limitations carried forward:**
- `diff.ts` returns "not yet supported" for graph files (PoC guard)
- File type cache in App.tsx is not invalidated on external type change (requires page reload)

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `apps/web/src/app/graph-view/graph-mappers.ts` | Pure functions: VyncGraphFile ↔ React Flow Node[]/Edge[] mapping (testable, DRY) |
| `apps/web/src/app/graph-view/use-graph-sync.ts` | Custom hook: GET/WS/PUT sync for graph files (mirrors FileBoard pattern) |
| `apps/web/src/app/graph-view/graph-mappers.test.ts` | Unit tests for mapping functions |
| `tools/server/__tests__/graph-put.test.ts` | Integration test: graph file PUT → GET roundtrip |

### Modified files
| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | VyncFile → discriminated union, add isGraphFile + isCanvasFile type guards, GraphNode/GraphEdge types |
| `packages/shared/src/index.ts` | Re-export new types |
| `packages/shared/src/__tests__/types.test.ts` | Graph type guard tests + malformed input + WsMessage graph shape |
| `apps/web/src/app/graph-view/GraphView.tsx` | Replace hardcoded data with sync hook, add CRUD (add/delete node/edge) |
| `apps/web/src/app/graph-view/graph-view.scss` | Add toolbar + CRUD button styles |
| `apps/web/src/app/app.tsx` | File type detection → route to GraphView or FileBoard |
| `apps/web/src/app/file-board.tsx` | Adapt to VyncCanvasFile (narrow generic) |
| `tools/cli/init.ts` | `--type graph` option → creates empty graph file |
| `tools/cli/main.ts` | Pass `--type` arg to init, update USAGE string |
| `tools/cli/__tests__/init.test.ts` | Add graph init tests (happy path + edge cases) |
| `tools/server/server.ts` | Remove PoC shim cast, use proper VyncFile union, add node/edge count limits |
| `.vync.schema.json` | Add `oneOf` for canvas vs graph |
| `skills/vync-editing/assets/schema.json` | Add graph file schema |

### Documentation updates (post-implementation)
| File | Change |
|------|--------|
| `docs/DECISIONS.md` | Add D-019: Graph View Architecture (React Flow + ELK.js, Plait 독립 렌더러) |
| `docs/DECISIONS.md` | Update D-005: 파일 포맷에 `type: 'graph'` 변형 추가 |
| `docs/FUTURE.md` | F-008 상태: `evaluating` → `planned` → `done` |
| `skills/vync-editing/SKILL.md` | Graph 파일 존재 언급, 캔버스 전용임 명시 |
| `commands/vync.md` | `init` 설명에 `--type graph` 옵션 추가 |

---

## Chunk 1: VyncFile Discriminated Union

The foundation: change VyncFile from a single interface to a discriminated union so that TypeScript enforces correct field access everywhere.

### Task 0: Branch Setup

**Files:** None (terminal only)

- [ ] **Step 1: Create feature branch**

```bash
git checkout develop && git pull
git checkout -b feat/graph-view
```

---

### Task 1: Define Graph Types in @vync/shared

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/types.test.ts`

- [ ] **Step 1: Write tests for the new types**

Add to `packages/shared/src/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { VyncFile, VyncCanvasFile, VyncGraphFile, GraphNode, GraphEdge } from '../types.js';
import { isGraphFile, isCanvasFile } from '../types.js';

// ... existing tests ...

describe('VyncFile discriminated union', () => {
  it('isGraphFile returns true for graph files', () => {
    const graph: VyncGraphFile = {
      version: 1,
      type: 'graph',
      viewport: { zoom: 1, x: 0, y: 0 },
      nodes: [],
      edges: [],
    };
    expect(isGraphFile(graph)).toBe(true);
    expect(isCanvasFile(graph)).toBe(false);
  });

  it('isGraphFile returns false for canvas files', () => {
    const canvas: VyncCanvasFile = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [],
    };
    expect(isGraphFile(canvas)).toBe(false);
    expect(isCanvasFile(canvas)).toBe(true);
  });

  it('isGraphFile returns false when type is undefined (legacy canvas)', () => {
    const legacy = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [],
    } as VyncFile;
    expect(isGraphFile(legacy)).toBe(false);
    expect(isCanvasFile(legacy)).toBe(true);
  });

  it('isGraphFile handles malformed input gracefully', () => {
    expect(isGraphFile({} as VyncFile)).toBe(false);
    expect(isCanvasFile({} as VyncFile)).toBe(true); // default fallback
  });

  it('GraphNode has required fields', () => {
    const node: GraphNode = {
      id: 'abc12',
      type: 'concept',
      position: { x: 0, y: 0 },
      data: { label: 'Test', category: 'class' },
    };
    expect(node.id).toBe('abc12');
    expect(node.data.label).toBe('Test');
  });

  it('GraphEdge has required fields', () => {
    const edge: GraphEdge = {
      id: 'e1f2g',
      source: 'abc12',
      target: 'h3i4j',
      data: { label: 'is-a', type: 'inheritance' },
    };
    expect(edge.source).toBe('abc12');
  });

  it('WsMessage accepts VyncGraphFile as data', () => {
    const msg: import('../types.js').WsMessage = {
      type: 'file-changed',
      data: { version: 1, type: 'graph', viewport: { zoom: 1, x: 0, y: 0 }, nodes: [], edges: [] },
    };
    expect(msg.type).toBe('file-changed');
  });
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
npx vitest run packages/shared/src/__tests__/types.test.ts
```

Expected: FAIL — `VyncCanvasFile`, `VyncGraphFile`, `GraphNode`, `GraphEdge`, `isGraphFile`, `isCanvasFile` not found.

- [ ] **Step 3: Implement types**

Replace `packages/shared/src/types.ts` contents:

```typescript
export interface VyncViewport {
  zoom: number;
  x: number;
  y: number;
}

// --- Canvas file (existing, backward-compatible) ---

// T defaults to unknown for server-side; frontend uses VyncCanvasFile<PlaitElement>
export interface VyncCanvasFile<T = unknown> {
  version: number;
  type?: 'canvas'; // optional for backward compatibility
  viewport: VyncViewport;
  elements: T[];
}

// --- Graph file ---

export interface GraphNodeData {
  label: string;
  category?: string;
  description?: string;
  properties?: Record<string, { type: string; required?: boolean }>;
}

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: GraphNodeData;
}

export interface GraphEdgeData {
  label: string;
  type?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  data: GraphEdgeData;
}

export interface VyncGraphFile {
  version: number;
  type: 'graph';
  viewport: VyncViewport;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Discriminated union ---

export type VyncFile<T = unknown> = VyncCanvasFile<T> | VyncGraphFile;

export function isGraphFile(f: VyncFile): f is VyncGraphFile {
  return f.type === 'graph';
}

export function isCanvasFile<T>(f: VyncFile<T>): f is VyncCanvasFile<T> {
  return f.type !== 'graph';
}

// --- WebSocket messages ---

export interface WsMessage<T = unknown> {
  type:
    | 'file-changed'
    | 'connected'
    | 'file-closed'
    | 'file-deleted'
    | 'error'
    | 'hub-file-registered'
    | 'hub-file-unregistered';
  filePath?: string;
  data?: VyncFile<T> | { files: string[] };
  code?: string;
}
```

- [ ] **Step 4: Update index.ts re-exports**

Update `packages/shared/src/index.ts` to export all new types:

```typescript
export type {
  VyncFile,
  VyncCanvasFile,
  VyncGraphFile,
  VyncViewport,
  GraphNode,
  GraphEdge,
  GraphNodeData,
  GraphEdgeData,
  WsMessage,
} from './types.js';
export { isGraphFile, isCanvasFile } from './types.js';
export { sha256 } from './hash.js';
```

- [ ] **Step 5: Run tests — should pass**

```bash
npx vitest run packages/shared/src/__tests__/types.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Fix compile errors from type change**

The `VyncFile` type changed — `elements` is no longer always present. Scan for compile errors:

```bash
npm run build:web 2>&1 | grep -i error | head -20
```

Fix each by narrowing. Key files and fixes:

**`apps/web/src/app/file-board.tsx`**: Already only deals with canvas files. Add type narrowing:
- Line 154: `const data = (await res.json()) as VyncCanvasFile<PlaitElement>;`  (was `VyncFile<PlaitElement>`)
- Line 200: `const fileData = msg.data as VyncCanvasFile<PlaitElement>;` (inside file-changed handler, after checking `'elements' in msg.data`)
- Line 289: `const vyncFile: VyncCanvasFile<PlaitElement> = {` (in handleChange PUT)

**`tools/cli/init.ts`**: `EMPTY_CANVAS` type annotation:
- `const EMPTY_CANVAS: VyncCanvasFile = {` (was `VyncFile`)

**`tools/server/server.ts`**: Already has type-based branch from PoC. Remove the `as Record<string, unknown>` cast on the graph branch — after narrowing via `data.type === 'graph'`, TypeScript knows it's `VyncGraphFile`.

Also add node/edge count limits in the graph validation branch:

```typescript
if (data.type === 'graph') {
  const gd = data as VyncGraphFile;
  if (!Array.isArray(gd.nodes) || !Array.isArray(gd.edges)) {
    res.status(400).json({ error: 'Graph file requires nodes and edges arrays' });
    return;
  }
  if (gd.nodes.length > 2000 || gd.edges.length > 5000) {
    res.status(413).json({ error: 'Graph exceeds maximum size (2000 nodes, 5000 edges)' });
    return;
  }
}
```

**`packages/board/src/data/json.ts:43`**: Uses `data.elements` but on its own `VyncExportedData` type (not `VyncFile`). **No change needed.**

**Test files** — these use object literals, not `VyncFile` type annotations, so they compile fine:
- `tools/server/__tests__/put-broadcast.test.ts:59` — **No change needed.**
- `tools/server/__tests__/sync-drain.test.ts:28` — **No change needed** (runtime access).
- `tools/server/__tests__/multi-file-e2e.test.ts:54,58` — **No change needed.**
- `tools/cli/__tests__/init.test.ts:25` — **No change needed.**

**`tools/cli/diff.ts:327`**: PoC already added `type === 'graph'` guard. **No change needed.**

For each file that needs changes: read → fix → save. Run build after each fix to verify progress.

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run
```

Expected: all 95+ tests pass. Zero regression.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/ apps/web/src/app/file-board.tsx tools/cli/init.ts tools/server/server.ts
git commit -m "refactor(types): VyncFile discriminated union (VyncCanvasFile | VyncGraphFile)

- Add GraphNode, GraphEdge, VyncGraphFile types
- isGraphFile() + isCanvasFile() type guards
- Narrow VyncCanvasFile in file-board.tsx, init.ts
- Server: node/edge count limits (2000/5000)
- Backward compatible: type field optional for canvas"
```

---

## Chunk 2: Type-Based Routing in App.tsx

Route to GraphView or FileBoard based on the file's `type` field, fetched on tab activation.

### Task 2: App.tsx File Type Detection + Routing

**Files:**
- Modify: `apps/web/src/app/app.tsx`

The routing strategy: when `activeFilePath` changes, fetch `GET /api/sync?file=<path>` and check `data.type`. Cache the result per file path to avoid re-fetching on tab switch.

**Known tradeoff — double-fetch:** This causes two GETs on first file open (type detection + component data load). Acceptable for simplicity. Optimization (pass fetched data as prop) deferred.

**Known limitation — no cache invalidation:** If a canvas file is externally converted to graph (or vice versa) while a tab is open, the routing won't update until page reload. Acceptable for MVP.

- [ ] **Step 1: Add file type cache and detection**

In `app.tsx`, add state for tracking file types:

```typescript
import { GraphView } from './graph-view/GraphView';
import type { VyncFile } from '@vync/shared';
import { isGraphFile } from '@vync/shared';

// Inside App():
const [fileTypes, setFileTypes] = useState<Record<string, 'canvas' | 'graph'>>({});
```

Add a `useEffect` that detects file type when `activeFilePath` changes:

```typescript
// File type detection
useEffect(() => {
  if (!activeFilePath) return;
  if (fileTypes[activeFilePath]) return; // already cached

  const detect = async () => {
    try {
      const res = await fetch(`/api/sync?file=${encodeURIComponent(activeFilePath)}`);
      if (res.ok) {
        const data = await res.json() as VyncFile;
        setFileTypes(prev => ({
          ...prev,
          [activeFilePath]: isGraphFile(data) ? 'graph' : 'canvas',
        }));
      }
    } catch {
      // Default to canvas on error
      setFileTypes(prev => ({ ...prev, [activeFilePath]: 'canvas' }));
    }
  };
  detect();
}, [activeFilePath, fileTypes]);
```

- [ ] **Step 2: Replace FileBoard with type-based routing**

In the render block, replace the `{activeFilePath ? <FileBoard ...` section:

```tsx
{activeFilePath ? (
  <div style={{ flex: 1, overflow: 'hidden' }}>
    {fileTypes[activeFilePath] === 'graph' ? (
      <GraphView key={activeFilePath} filePath={activeFilePath} />
    ) : (
      <FileBoard key={activeFilePath} filePath={activeFilePath} />
    )}
  </div>
) : (
  <NoFileView />
)}
```

- [ ] **Step 3: Update GraphView to accept filePath prop**

Temporarily update `GraphView.tsx` signature to accept `filePath` (sync will come in Chunk 3):

```typescript
interface GraphViewProps {
  filePath: string;
}

export function GraphView({ filePath }: GraphViewProps) {
  // ... existing PoC code, filePath used later for sync
```

- [ ] **Step 4: Build and verify**

```bash
npm run build:web
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/app.tsx apps/web/src/app/graph-view/GraphView.tsx
git commit -m "feat(graph): type-based routing — GraphView or FileBoard per file type"
```

---

## Chunk 3: GraphView Sync (GET / WS / PUT)

The most critical chunk. GraphView gets real-time sync using the same pipeline as FileBoard: initial GET → WebSocket subscription → debounced PUT on change.

### Task 3: Create Graph Mappers (Pure Functions)

**Files:**
- Create: `apps/web/src/app/graph-view/graph-mappers.ts`
- Create: `apps/web/src/app/graph-view/graph-mappers.test.ts`

Extract VyncGraphFile ↔ React Flow Node[]/Edge[] mapping as pure, testable functions. These are used in 3 places (initial GET, WS handler, buildFile) — DRY.

- [ ] **Step 1: Write tests for mappers**

Create `apps/web/src/app/graph-view/graph-mappers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  toReactFlowNodes,
  toReactFlowEdges,
  toVyncNodes,
  toVyncEdges,
} from './graph-mappers';
import type { GraphNode, GraphEdge } from '@vync/shared';

describe('graph-mappers', () => {
  const vyncNodes: GraphNode[] = [
    { id: 'n1', type: 'concept', position: { x: 10, y: 20 }, data: { label: 'Person', category: 'class' } },
  ];
  const vyncEdges: GraphEdge[] = [
    { id: 'e1', source: 'n1', target: 'n2', data: { label: 'is-a', type: 'inheritance' } },
  ];

  it('toReactFlowNodes maps VyncGraphFile nodes to React Flow nodes', () => {
    const rfNodes = toReactFlowNodes(vyncNodes);
    expect(rfNodes).toHaveLength(1);
    expect(rfNodes[0].id).toBe('n1');
    expect(rfNodes[0].position).toEqual({ x: 10, y: 20 });
    expect(rfNodes[0].data.label).toBe('Person');
  });

  it('toReactFlowEdges maps VyncGraphFile edges to React Flow edges', () => {
    const rfEdges = toReactFlowEdges(vyncEdges);
    expect(rfEdges).toHaveLength(1);
    expect(rfEdges[0].source).toBe('n1');
    expect(rfEdges[0].label).toBe('is-a');
  });

  it('toVyncNodes maps React Flow nodes back to VyncGraphFile nodes', () => {
    const rfNodes = toReactFlowNodes(vyncNodes);
    const roundtrip = toVyncNodes(rfNodes);
    expect(roundtrip[0].id).toBe('n1');
    expect(roundtrip[0].data.label).toBe('Person');
    expect(roundtrip[0].data.category).toBe('class');
  });

  it('toVyncEdges maps React Flow edges back to VyncGraphFile edges', () => {
    const rfEdges = toReactFlowEdges(vyncEdges);
    const roundtrip = toVyncEdges(rfEdges);
    expect(roundtrip[0].source).toBe('n1');
    expect(roundtrip[0].data.label).toBe('is-a');
  });

  it('handles empty arrays', () => {
    expect(toReactFlowNodes([])).toEqual([]);
    expect(toReactFlowEdges([])).toEqual([]);
    expect(toVyncNodes([])).toEqual([]);
    expect(toVyncEdges([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
npx vitest run apps/web/src/app/graph-view/graph-mappers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement mappers**

Create `apps/web/src/app/graph-view/graph-mappers.ts`:

```typescript
import type { Node, Edge } from '@xyflow/react';
import type { GraphNode, GraphEdge, GraphNodeData, GraphEdgeData } from '@vync/shared';

export function toReactFlowNodes(vyncNodes: GraphNode[]): Node[] {
  return vyncNodes.map((n) => ({
    id: n.id,
    type: n.type || 'default',
    position: n.position,
    data: n.data,
  }));
}

export function toReactFlowEdges(vyncEdges: GraphEdge[]): Edge[] {
  return vyncEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.data?.label,
    data: e.data,
  }));
}

export function toVyncNodes(rfNodes: Node[]): GraphNode[] {
  return rfNodes.map((n) => ({
    id: n.id,
    type: n.type || 'concept',
    position: n.position,
    data: n.data as GraphNodeData,
  }));
}

export function toVyncEdges(rfEdges: Edge[]): GraphEdge[] {
  return rfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: (e.data || { label: e.label || '' }) as GraphEdgeData,
  }));
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npx vitest run apps/web/src/app/graph-view/graph-mappers.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/graph-view/graph-mappers.ts apps/web/src/app/graph-view/graph-mappers.test.ts
git commit -m "feat(graph): pure mapping functions VyncGraphFile ↔ React Flow"
```

---

### Task 4: Implement useGraphSync Hook

**Files:**
- Create: `apps/web/src/app/graph-view/use-graph-sync.ts`
- Modify: `apps/web/src/app/graph-view/GraphView.tsx`

The hook mirrors FileBoard's sync pattern but returns React Flow nodes/edges instead of PlaitElement[].

**Key design decisions (from architecture review):**
- `viewportRef` pattern to prevent stale closure in `buildFile` (C-2)
- `remoteUpdateUntilRef` guard in both `schedulePut` AND `saveNow` (C-3)
- WS handler updates viewport from remote changes (C-2)
- `idCreator(5)` for ID generation, not `Date.now().toString(36)` (C-4)
- `onEdgesChange` triggers sync on remove changes (S-4)
- `onNodesChange`/`onEdgesChange` check echo guard before triggering sync (C-1)

- [ ] **Step 1: Create the sync hook**

Create `apps/web/src/app/graph-view/use-graph-sync.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { VyncGraphFile, WsMessage, VyncViewport } from '@vync/shared';
import { toReactFlowNodes, toReactFlowEdges, toVyncNodes, toVyncEdges } from './graph-mappers';

const SYNC_DEBOUNCE_MS = 300;

interface UseGraphSyncResult {
  nodes: Node[];
  edges: Edge[];
  viewport: VyncViewport;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  syncEnabled: boolean;
  saveNow: () => void;
  isRemoteUpdate: () => boolean;
}

export function useGraphSync(filePath: string): UseGraphSyncResult {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [viewport, setViewport] = useState<VyncViewport>({ zoom: 1, x: 0, y: 0 });
  const [syncEnabled, setSyncEnabled] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteUpdateUntilRef = useRef(0);

  // Refs for latest values (avoid stale closures)
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(viewport);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  viewportRef.current = viewport;

  const fileParam = encodeURIComponent(filePath);

  // Check if currently in remote-update suppression window
  const isRemoteUpdate = useCallback(
    () => Date.now() < remoteUpdateUntilRef.current,
    []
  );

  // Build VyncGraphFile from current state (uses refs to avoid stale closures)
  const buildFile = useCallback((): VyncGraphFile => ({
    version: 1,
    type: 'graph',
    viewport: viewportRef.current,
    nodes: toVyncNodes(nodesRef.current),
    edges: toVyncEdges(edgesRef.current),
  }), []);

  // Debounced PUT
  const schedulePut = useCallback(() => {
    if (Date.now() < remoteUpdateUntilRef.current) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const file = buildFile();
      fetch(`/api/sync?file=${fileParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file),
      }).catch(err => console.error('[vync] Graph sync failed:', err));
    }, SYNC_DEBOUNCE_MS);
  }, [fileParam, buildFile]);

  // Immediate save (with echo guard — C-3 fix)
  const saveNow = useCallback(() => {
    if (Date.now() < remoteUpdateUntilRef.current) return; // C-3: echo guard
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const file = buildFile();
    fetch(`/api/sync?file=${fileParam}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    }).catch(err => console.error('[vync] Graph sync failed:', err));
  }, [fileParam, buildFile]);

  // Initial GET
  useEffect(() => {
    const loadData = async () => {
      try {
        let res = await fetch(`/api/sync?file=${fileParam}`);
        if (res.status === 404) {
          const regRes = await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath }),
          });
          if (regRes.ok) {
            res = await fetch(`/api/sync?file=${fileParam}`);
          }
        }
        if (res.ok) {
          const data = await res.json() as VyncGraphFile;
          setNodes(toReactFlowNodes(data.nodes));
          setEdges(toReactFlowEdges(data.edges));
          setViewport(data.viewport);
          setSyncEnabled(true);
        }
      } catch {
        console.error('[vync] Failed to load graph file');
      }
    };
    loadData();
  }, [filePath, fileParam]);

  // WebSocket
  useEffect(() => {
    if (!syncEnabled) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?file=${fileParam}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          if (msg.type === 'file-changed' && msg.data && 'nodes' in msg.data) {
            const graphData = msg.data as VyncGraphFile;

            // Echo guard
            remoteUpdateUntilRef.current = Date.now() + 500;

            setNodes(toReactFlowNodes(graphData.nodes));
            setEdges(toReactFlowEdges(graphData.edges));
            setViewport(graphData.viewport); // C-2: update viewport from remote
          }
        } catch (err) {
          console.error('[vync] Failed to parse WS message:', err);
        }
      };

      ws.onclose = () => {
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [syncEnabled, filePath, fileParam]);

  return { nodes, edges, viewport, setNodes, setEdges, syncEnabled, saveNow, isRemoteUpdate };
}
```

- [ ] **Step 2: Rewrite GraphView.tsx to use sync hook**

Replace `apps/web/src/app/graph-view/GraphView.tsx`:

```tsx
import { useCallback } from 'react';
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled';
import { idCreator } from '@plait/core';
import { useGraphSync } from './use-graph-sync';
import './graph-view.scss';

const elk = new ELK();

type LayoutAlgorithm = 'layered' | 'stress';

interface GraphViewProps {
  filePath: string;
}

export function GraphView({ filePath }: GraphViewProps) {
  const { nodes, edges, setNodes, setEdges, syncEnabled, saveNow, isRemoteUpdate } =
    useGraphSync(filePath);

  // C-1 fix: check echo guard before triggering sync
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      if (isRemoteUpdate()) return; // C-1: suppress sync during remote update
      // Position changes (drag end) trigger sync
      if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
        saveNow();
      }
      // Node removal triggers sync
      if (changes.some((c) => c.type === 'remove')) {
        saveNow();
      }
    },
    [setNodes, saveNow, isRemoteUpdate]
  );

  // S-4 fix: edge changes trigger sync too
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      if (isRemoteUpdate()) return; // C-1: suppress sync during remote update
      // Edge removal triggers sync
      if (changes.some((c) => c.type === 'remove')) {
        saveNow();
      }
    },
    [setEdges, saveNow, isRemoteUpdate]
  );

  // C-4 fix: use idCreator(5) for Vync convention
  const onConnect: OnConnect = useCallback(
    (params) => {
      const id = idCreator(5);
      setEdges((eds) =>
        addEdge({ ...params, id, data: { label: 'relates-to', type: 'association' } }, eds)
      );
      saveNow();
    },
    [setEdges, saveNow]
  );

  const handleLayout = useCallback(
    async (algorithm: LayoutAlgorithm) => {
      const elkGraph = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm':
            algorithm === 'layered'
              ? 'org.eclipse.elk.layered'
              : 'org.eclipse.elk.stress',
          'elk.spacing.nodeNode': '80',
          'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        },
        children: nodes.map((n) => ({ id: n.id, width: 150, height: 40 })),
        edges: edges.map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      };
      const layout = await elk.layout(elkGraph);
      setNodes((nds) =>
        nds.map((node) => {
          const elkNode = layout.children?.find((n) => n.id === node.id);
          return {
            ...node,
            position: {
              x: elkNode?.x ?? node.position.x,
              y: elkNode?.y ?? node.position.y,
            },
          };
        })
      );
      saveNow();
    },
    [nodes, edges, setNodes, saveNow]
  );

  // C-4 fix: use idCreator(5)
  const handleAddNode = useCallback(() => {
    const id = idCreator(5);
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'default',
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: { label: 'New Concept', category: 'class' },
      },
    ]);
    saveNow();
  }, [setNodes, saveNow]);

  if (!syncEnabled) {
    return (
      <div className="graph-view-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading graph...
      </div>
    );
  }

  return (
    <div className="graph-view-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      <div className="graph-view-controls">
        <button onClick={handleAddNode}>+ Node</button>
        <button onClick={() => handleLayout('layered')}>Hierarchical</button>
        <button onClick={() => handleLayout('stress')}>Force</button>
      </div>
    </div>
  );
}
```

**Note on `idCreator` import:** `idCreator` is from `@plait/core`. If this import causes issues (tree-shaking, circular deps), inline a minimal version: `const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; function generateId(len=5) { return Array.from({length:len}, ()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }`

- [ ] **Step 3: Build and verify**

```bash
npm run build:web
```

Expected: build succeeds.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/graph-view/
git commit -m "feat(graph): real-time sync via useGraphSync hook

- GET initial data, WS subscription, debounced PUT
- Echo prevention: remoteUpdateUntilRef guard in schedulePut + saveNow + handlers
- Viewport sync from remote updates (viewportRef pattern)
- CRUD: add node, connect edges, delete nodes/edges, drag positioning
- ELK.js layout toggle (Hierarchical / Force)
- idCreator(5) for Vync ID convention
- DRY: graph-mappers.ts pure functions for VyncGraphFile ↔ React Flow mapping"
```

---

## Chunk 4: CLI `vync init --type graph` + Schema Updates

### Task 5: CLI Graph Init

**Files:**
- Modify: `tools/cli/init.ts`
- Modify: `tools/cli/main.ts`
- Test: `tools/cli/__tests__/init.test.ts`

- [ ] **Step 1: Write tests for graph init**

Add to `tools/cli/__tests__/init.test.ts`:

```typescript
it('creates a graph file with --type graph', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.VYNC_CALLER_CWD = tmpDir;

  await vyncInit('ontology', { type: 'graph' });

  const file = path.join(tmpDir, '.vync', 'ontology.vync');
  const raw = await fs.readFile(file, 'utf-8');
  const data = JSON.parse(raw);
  expect(data.type).toBe('graph');
  expect(data.nodes).toEqual([]);
  expect(data.edges).toEqual([]);
  expect(data.elements).toBeUndefined();
  expect(data.version).toBe(1);
  expect(data.viewport).toBeDefined();
});

it('graph init throws if file already exists', async () => {
  await fs.mkdir(path.join(tmpDir, '.vync'), { recursive: true });
  process.env.VYNC_CALLER_CWD = tmpDir;
  await fs.writeFile(path.join(tmpDir, '.vync', 'existing.vync'), '{}');

  await expect(vyncInit('existing', { type: 'graph' })).rejects.toThrow('already exists');
});

it('defaults to canvas when no type option given', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.VYNC_CALLER_CWD = tmpDir;

  await vyncInit('plain');

  const file = path.join(tmpDir, '.vync', 'plain.vync');
  const raw = await fs.readFile(file, 'utf-8');
  const data = JSON.parse(raw);
  expect(data.elements).toEqual([]);
  expect(data.type).toBeUndefined();
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
npx vitest run tools/cli/__tests__/init.test.ts
```

Expected: FAIL — `vyncInit` doesn't accept options.

- [ ] **Step 3: Update init.ts**

Replace `tools/cli/init.ts` entirely:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VyncCanvasFile, VyncGraphFile } from '@vync/shared';
import { resolveVyncPath } from './resolve.js';

interface InitOptions {
  type?: 'canvas' | 'graph';
}

const EMPTY_CANVAS: VyncCanvasFile = {
  version: 1,
  viewport: { zoom: 1, x: 0, y: 0 },
  elements: [],
};

const EMPTY_GRAPH: VyncGraphFile = {
  version: 1,
  type: 'graph',
  viewport: { zoom: 1, x: 0, y: 0 },
  nodes: [],
  edges: [],
};

export async function vyncInit(filePath: string, options?: InitOptions): Promise<string> {
  const absolute = resolveVyncPath(filePath);

  try {
    await fs.access(absolute);
    throw new Error(`File already exists: ${absolute}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const content = options?.type === 'graph' ? EMPTY_GRAPH : EMPTY_CANVAS;
  await fs.writeFile(absolute, JSON.stringify(content, null, 2), 'utf-8');

  return absolute;
}
```

- [ ] **Step 4: Update main.ts — pass --type + update USAGE string**

In `tools/cli/main.ts`:

**Update USAGE string** (S-7):
```
  init <file>    Create .vync file in CWD/.vync/
                 --type graph  Create graph file (default: canvas)
```

**Replace `case 'init'` block:**

```typescript
case 'init': {
  const typeIdx = args.indexOf('--type');
  const fileType = typeIdx >= 0 ? args[typeIdx + 1] : undefined;
  // Skip --type and its value when finding the file path
  const filePath = args.find((a, i) => !a.startsWith('--') && i !== typeIdx + 1);
  if (!filePath) {
    console.error('Usage: vync init <file> [--type graph]');
    process.exit(1);
  }
  const created = await vyncInit(filePath, {
    type: fileType === 'graph' ? 'graph' : undefined,
  });
  console.log(`[vync] Created: ${created}`);
  break;
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tools/cli/__tests__/init.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add tools/cli/init.ts tools/cli/main.ts tools/cli/__tests__/init.test.ts
git commit -m "feat(cli): vync init --type graph creates empty graph file"
```

---

### Task 6: Update JSON Schemas + Plugin Cache

**Files:**
- Modify: `.vync.schema.json`
- Modify: `skills/vync-editing/assets/schema.json`

- [ ] **Step 1: Update root schema**

Update `.vync.schema.json` to support both canvas and graph files using `oneOf`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VyncFile",
  "description": ".vync file format (canvas or graph)",
  "type": "object",
  "oneOf": [
    { "$ref": "#/$defs/CanvasFile" },
    { "$ref": "#/$defs/GraphFile" }
  ],
  "$defs": {
    "Viewport": {
      "type": "object",
      "required": ["zoom", "x", "y"],
      "properties": {
        "zoom": { "type": "number", "exclusiveMinimum": 0 },
        "x": { "type": "number" },
        "y": { "type": "number" }
      },
      "additionalProperties": false
    },
    "Point": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 2,
      "maxItems": 2
    },
    "PlaitElement": {
      "type": "object",
      "required": ["id"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "type": { "type": "string" },
        "children": { "type": "array" },
        "points": { "type": "array", "items": { "$ref": "#/$defs/Point" } },
        "groupId": { "type": "string" },
        "angle": { "type": "number" }
      }
    },
    "GraphNode": {
      "type": "object",
      "required": ["id", "type", "position", "data"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "type": { "type": "string" },
        "position": {
          "type": "object",
          "required": ["x", "y"],
          "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
          "additionalProperties": false
        },
        "data": {
          "type": "object",
          "required": ["label"],
          "properties": {
            "label": { "type": "string", "maxLength": 512 },
            "category": { "type": "string", "maxLength": 128 },
            "description": { "type": "string", "maxLength": 4096 },
            "properties": { "type": "object" }
          }
        }
      }
    },
    "GraphEdge": {
      "type": "object",
      "required": ["id", "source", "target"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "source": { "type": "string" },
        "target": { "type": "string" },
        "data": {
          "type": "object",
          "properties": {
            "label": { "type": "string", "maxLength": 256 },
            "type": { "type": "string" }
          }
        }
      }
    },
    "CanvasFile": {
      "type": "object",
      "required": ["version", "viewport", "elements"],
      "properties": {
        "version": { "type": "integer", "const": 1 },
        "type": { "type": "string", "enum": ["canvas"] },
        "viewport": { "$ref": "#/$defs/Viewport" },
        "elements": { "type": "array", "items": { "$ref": "#/$defs/PlaitElement" } }
      },
      "additionalProperties": false
    },
    "GraphFile": {
      "type": "object",
      "required": ["version", "type", "viewport", "nodes", "edges"],
      "properties": {
        "version": { "type": "integer", "const": 1 },
        "type": { "type": "string", "const": "graph" },
        "viewport": { "$ref": "#/$defs/Viewport" },
        "nodes": { "type": "array", "items": { "$ref": "#/$defs/GraphNode" }, "maxItems": 2000 },
        "edges": { "type": "array", "items": { "$ref": "#/$defs/GraphEdge" }, "maxItems": 5000 }
      },
      "additionalProperties": false
    }
  }
}
```

- [ ] **Step 2: Copy updated schema to skills assets**

```bash
cp .vync.schema.json skills/vync-editing/assets/schema.json
```

- [ ] **Step 3: Validate test fixture against schema**

```bash
node -e "
const graph = require('./tools/server/__tests__/fixtures/graph-test.vync');
console.log('type:', graph.type);
console.log('has nodes:', Array.isArray(graph.nodes));
console.log('has edges:', Array.isArray(graph.edges));
console.log('has elements:', 'elements' in graph);
"
```

Expected: `type: graph`, `has nodes: true`, `has edges: true`, `has elements: false` (after shim removal).

- [ ] **Step 4: Remove `elements: []` shim from graph fixture**

Update `tools/server/__tests__/fixtures/graph-test.vync` — remove the `"elements": []` line. The shim is no longer needed now that the types are properly separated.

First, verify no tests reference this fixture's `.elements`:

```bash
grep -rn 'graph-test.vync' tools/ --include='*.ts' | grep -v 'node_modules'
```

Expected: only the fixture file path appears in file references, no `.elements` access on its data. The fixture is currently only used for manual verification, not in automated tests.

- [ ] **Step 5: Sync plugin cache** (S-8)

```bash
bash .claude-plugin/install.sh
```

This syncs the updated schema to the Claude Code plugin cache.

- [ ] **Step 6: Commit**

```bash
git add .vync.schema.json skills/vync-editing/assets/schema.json tools/server/__tests__/fixtures/graph-test.vync
git commit -m "feat(schema): add graph file schema, remove elements shim from fixture"
```

---

## Chunk 5: Server Integration Test + E2E Verification

### Task 7: Server PUT Integration Test for Graph Files (S-2)

**Files:**
- Create: `tools/server/__tests__/graph-put.test.ts`

- [ ] **Step 1: Write graph PUT integration test**

Create `tools/server/__tests__/graph-put.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHubServer } from '../server.js';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('Graph file PUT/GET roundtrip', () => {
  let server: any;
  let port: number;
  let tmpDir: string;
  let graphFile: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-put-test-'));
    graphFile = path.join(tmpDir, 'test.vync');
    fs.writeFileSync(graphFile, JSON.stringify({
      version: 1,
      type: 'graph',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{ id: 'n1', type: 'concept', position: { x: 0, y: 0 }, data: { label: 'Initial' } }],
      edges: [],
    }));
    clearAllowedDirs();
    addAllowedDir(tmpDir);
    const result = await createHubServer({ initialFile: graphFile, port: 0 });
    server = result.server;
    port = result.port;
  });

  afterAll(async () => {
    server?.close();
    clearAllowedDirs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts graph file PUT and returns same data on GET', async () => {
    const graphPayload = {
      version: 1,
      type: 'graph',
      viewport: { x: 10, y: 20, zoom: 2 },
      nodes: [
        { id: 'n1', type: 'concept', position: { x: 100, y: 200 }, data: { label: 'Person', category: 'class' } },
        { id: 'n2', type: 'concept', position: { x: 300, y: 200 }, data: { label: 'Employee' } },
      ],
      edges: [
        { id: 'e1', source: 'n2', target: 'n1', data: { label: 'is-a', type: 'inheritance' } },
      ],
    };

    // PUT
    const putRes = await fetch(`http://localhost:${port}/api/sync?file=${graphFile}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphPayload),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);

    // GET — wait for file write
    await new Promise(r => setTimeout(r, 100));
    const getRes = await fetch(`http://localhost:${port}/api/sync?file=${graphFile}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.type).toBe('graph');
    expect(getData.nodes).toHaveLength(2);
    expect(getData.edges).toHaveLength(1);
    expect(getData.nodes[0].data.label).toBe('Person');
  });

  it('rejects graph file exceeding node limit', async () => {
    const bigPayload = {
      version: 1,
      type: 'graph',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: Array.from({ length: 2001 }, (_, i) => ({
        id: `n${i}`, type: 'concept', position: { x: 0, y: 0 }, data: { label: `Node ${i}` },
      })),
      edges: [],
    };

    const res = await fetch(`http://localhost:${port}/api/sync?file=${graphFile}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bigPayload),
    });
    expect(res.status).toBe(413);
  });

  it('canvas file PUT still works alongside graph files', async () => {
    const canvasFile = path.join(tmpDir, 'canvas.vync');
    fs.writeFileSync(canvasFile, JSON.stringify({
      version: 1, viewport: { x: 0, y: 0, zoom: 1 }, elements: [],
    }));
    // Register canvas file
    await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: canvasFile }),
    });

    const putRes = await fetch(`http://localhost:${port}/api/sync?file=${canvasFile}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, elements: [] }),
    });
    expect(putRes.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tools/server/__tests__/graph-put.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tools/server/__tests__/graph-put.test.ts
git commit -m "test(graph): server PUT/GET roundtrip + node limit + canvas coexistence"
```

---

### Task 8: Full E2E Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (95+ existing + new graph tests).

- [ ] **Step 2: Build verification**

```bash
npm run build:web
```

Expected: build succeeds.

- [ ] **Step 3: Manual E2E — create and view graph file**

```bash
# Terminal 1
tmux new-session -d -s dev "npm run dev:server"

# Terminal 2
sleep 3
npx tsx tools/cli/main.ts init test-graph --type graph
npx tsx tools/cli/main.ts open test-graph
```

Verify in browser:
- [ ] GraphView renders (not FileBoard) — React Flow canvas with controls
- [ ] "+ Node" button adds a new node
- [ ] Hierarchical/Force layout buttons work
- [ ] Drag a node → release → verify position saved (reload page, node stays)
- [ ] Connect two nodes by dragging from handle → edge created and persisted
- [ ] Select a node and press Delete → node removed and persisted

- [ ] **Step 4: Manual E2E — canvas file still works**

```bash
npx tsx tools/cli/main.ts open  # opens existing canvas file
```

Verify:
- [ ] FileBoard renders (not GraphView)
- [ ] Canvas editing works as before

- [ ] **Step 5: Manual E2E — external edit sync**

With the graph file open in browser:
```bash
node -e "
const fs = require('fs');
const path = require('path');
const f = path.join(process.cwd(), '.vync/test-graph.vync');
const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
data.nodes.push({ id: 'ext1', type: 'concept', position: { x: 400, y: 0 }, data: { label: 'Company', category: 'class' } });
fs.writeFileSync(f, JSON.stringify(data, null, 2));
"
```

Verify in browser:
- [ ] New "Company" node appears within ~1 second
- [ ] No console errors
- [ ] No echo loop (node doesn't flicker or duplicate)

- [ ] **Step 6: Cleanup test file**

```bash
rm -f .vync/test-graph.vync
tmux kill-session -t dev
```

---

### Task 9: Electron Bundle Rebuild

**Files:** None (build only)

Per CLAUDE.md, server/shared changes require Electron bundle rebuild.

- [ ] **Step 1: Rebuild Electron bundle**

```bash
npx esbuild tools/electron/main.ts --bundle --platform=node --outdir=dist/electron --external:electron --packages=external --alias:@vync/shared=./packages/shared/src/index.ts --sourcemap
```

Expected: bundle succeeds.

- [ ] **Step 2: Commit bundle**

```bash
git add dist/electron/
git commit -m "chore: rebuild Electron bundle with graph file types"
```

---

### Task 10: Documentation Updates + Final Push

- [ ] **Step 1: Update DECISIONS.md**

Add D-019:
```markdown
| D-019 | Graph View Architecture | React Flow v12 + ELK.js, Plait 독립 렌더러 | Plait 확장, Cytoscape.js, G6 | React Flow는 React 19 호환, 노드가 React 컴포넌트, JSON 구조가 AI 편집에 적합 | React Flow v12가 React 19 미지원 시 | 2026-03-16 |
```

Update D-005 note:
```markdown
> **2026-03-16 확장**: `type: "graph"` 변형 추가. Canvas(`elements[]`) 또는 Graph(`nodes[]`+`edges[]`). Discriminated union으로 구분.
```

- [ ] **Step 2: Update FUTURE.md**

F-008 상태를 `evaluating` → `done` 으로 변경. 구현 계획 링크 추가.

- [ ] **Step 3: Update commands/vync.md**

`init` 설명에 `--type graph` 옵션 추가.

- [ ] **Step 4: Run full test suite one final time**

```bash
npx vitest run
npm run build:web
```

Expected: all pass.

- [ ] **Step 5: Commit docs + push**

```bash
git add docs/DECISIONS.md docs/FUTURE.md commands/vync.md
git commit -m "docs: D-019 graph view architecture, F-008 done, init --type graph"
git push -u origin feat/graph-view
```

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| useGraphSync as custom hook | Separation of concerns; mirrors FileBoard pattern |
| `viewportRef` pattern | Prevents stale viewport in `buildFile` closures (Architect C-2) |
| Echo guard in `saveNow` + handlers | Prevents echo loops from remote position changes (Architect C-1, Security C-3) |
| `isRemoteUpdate()` exposed from hook | Allows handlers to skip sync during remote update window |
| `idCreator(5)` for IDs | Vync convention compliance (Domain Expert C-4) |
| `graph-mappers.ts` pure functions | DRY (3 call sites), testable, eliminates `as any` casts (QA S-1, Security S-6) |
| Server node/edge count limits | DoS prevention: 2000 nodes, 5000 edges (Security S-5) |
| `isCanvasFile` type guard | Prevents `switch(f.type)` trap with legacy files (Architect D-5) |
| File type cache, no invalidation | MVP tradeoff — cache reset requires page reload |
| Double-fetch on first open | Simplicity over efficiency — optimize later if needed |
| No useGraphSync unit tests | WebSocket + fetch difficult to mock; covered by E2E. Pure logic extracted to testable `graph-mappers.ts` |
| D-019 decision record | React Flow + ELK.js, Plait 독립 — fundamental architecture change warrants record |

## Review Feedback Applied

This plan incorporates feedback from 4 parallel expert reviews:

| Source | Items Applied |
|--------|-------------|
| **Architect** | C-1 echo loop fix, C-2 viewport stale closure, S-4 edge sync, D-5 isCanvasFile |
| **QA/Testing** | S-1 graph-mappers extraction, S-2 server PUT test, S-3 malformed input test |
| **Domain Expert** | C-4 idCreator, S-7 USAGE string, S-8 plugin cache, D-1~D-4 docs |
| **Security** | C-3 saveNow echo guard, S-5 node/edge limits, S-6 remove `as any`, schema maxLength |
