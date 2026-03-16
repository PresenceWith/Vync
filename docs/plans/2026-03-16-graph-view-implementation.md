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

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `apps/web/src/app/graph-view/graph-types.ts` | GraphNode, GraphEdge, VyncGraphFile interfaces + type guard |
| `apps/web/src/app/graph-view/use-graph-sync.ts` | Custom hook: GET/WS/PUT sync for graph files (mirrors FileBoard pattern) |
| `apps/web/src/app/graph-view/graph-view.test.ts` | Unit tests for sync hook and type utils |
| `packages/shared/src/__tests__/types.test.ts` | Extended: graph file type guard tests |

### Modified files
| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | VyncFile → discriminated union (VyncCanvasFile \| VyncGraphFile), add type guard + GraphNode/GraphEdge types |
| `packages/shared/src/index.ts` | Re-export new types |
| `apps/web/src/app/graph-view/GraphView.tsx` | Replace hardcoded data with sync hook, add CRUD (add/delete node/edge) |
| `apps/web/src/app/graph-view/graph-view.scss` | Add toolbar + CRUD button styles |
| `apps/web/src/app/app.tsx` | File type detection → route to GraphView or FileBoard |
| `apps/web/src/app/file-board.tsx` | Adapt to VyncCanvasFile (narrow generic) |
| `tools/cli/init.ts` | `--type graph` option → creates empty graph file |
| `tools/cli/main.ts` | Pass `--type` arg to init |
| `tools/cli/__tests__/init.test.ts` | Add graph init tests |
| `tools/server/server.ts` | Remove PoC shim cast, use proper VyncFile union |
| `.vync.schema.json` | Add `oneOf` for canvas vs graph |
| `skills/vync-editing/assets/schema.json` | Add graph file schema |

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
import { isGraphFile } from '../types.js';

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
  });

  it('isGraphFile returns false for canvas files', () => {
    const canvas: VyncCanvasFile = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [],
    };
    expect(isGraphFile(canvas)).toBe(false);
  });

  it('isGraphFile returns false when type is undefined', () => {
    const legacy = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [],
    } as VyncFile;
    expect(isGraphFile(legacy)).toBe(false);
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
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
npx vitest run packages/shared/src/__tests__/types.test.ts
```

Expected: FAIL — `VyncCanvasFile`, `VyncGraphFile`, `GraphNode`, `GraphEdge`, `isGraphFile` not found.

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
export { isGraphFile } from './types.js';
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

**`tools/server/server.ts`**: Already has type-based branch from PoC. Remove the `as Record<string, unknown>` cast, use proper union:
- Line 203: `const data = req.body as VyncFile;` — keep as-is (union type)
- The if/else branch already works with the union

**`packages/board/src/data/json.ts:43`**: Uses `data.elements` but on its own `VyncExportedData` type (not `VyncFile`). **No change needed.**

**Test files** — these use object literals, not `VyncFile` type annotations, so they compile fine:
- `tools/server/__tests__/put-broadcast.test.ts:59` — uses inline `{ elements: [...] }` object. **No change needed.**
- `tools/server/__tests__/sync-drain.test.ts:28` — accesses `content.elements` on parsed JSON. **No change needed** (runtime access, not typed).
- `tools/server/__tests__/multi-file-e2e.test.ts:54,58` — same pattern. **No change needed.**
- `tools/cli/__tests__/init.test.ts:25` — checks `data.elements` on parsed JSON. **No change needed.**

**`tools/cli/diff.ts:327`**: Accesses `currentData.elements` but our PoC already added a `type === 'graph'` guard above (line 329). **No change needed.**

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
- isGraphFile() type guard
- Narrow VyncCanvasFile in file-board.tsx, init.ts
- Backward compatible: type field optional for canvas"
```

---

## Chunk 2: Type-Based Routing in App.tsx

Route to GraphView or FileBoard based on the file's `type` field, fetched on tab activation.

### Task 2: App.tsx File Type Detection + Routing

**Files:**
- Modify: `apps/web/src/app/app.tsx`

The routing strategy: when `activeFilePath` changes, fetch `GET /api/sync?file=<path>` and check `data.type`. Cache the result per file path to avoid re-fetching on tab switch.

**Note (known tradeoff):** This causes a double-fetch on first file open — one for type detection here, another in GraphView/FileBoard for initial data. This is a simplicity-over-efficiency tradeoff. Optimization (passing fetched data as prop) can be done later if needed.

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

### Task 3: Implement useGraphSync Hook

**Files:**
- Create: `apps/web/src/app/graph-view/use-graph-sync.ts`
- Modify: `apps/web/src/app/graph-view/GraphView.tsx`

The hook mirrors FileBoard's sync pattern but returns React Flow nodes/edges instead of PlaitElement[].

**Testing note:** `useGraphSync` uses WebSocket + fetch, which are difficult to unit test without mocking the entire browser environment. The existing FileBoard sync logic also has no unit tests — it's verified via E2E in Chunk 5 (Task 6). We follow the same pattern here: integration testing via manual E2E. If unit tests are desired later, extract pure logic (node/edge mapping) into testable helper functions.

- [ ] **Step 1: Create the sync hook**

Create `apps/web/src/app/graph-view/use-graph-sync.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { VyncGraphFile, WsMessage, VyncViewport } from '@vync/shared';

const SYNC_DEBOUNCE_MS = 300;

interface UseGraphSyncResult {
  nodes: Node[];
  edges: Edge[];
  viewport: VyncViewport;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  syncEnabled: boolean;
  saveNow: () => void;
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
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const fileParam = encodeURIComponent(filePath);

  // Build VyncGraphFile from current state
  const buildFile = useCallback((): VyncGraphFile => ({
    version: 1,
    type: 'graph',
    viewport,
    nodes: nodesRef.current.map(n => ({
      id: n.id,
      type: n.type || 'concept',
      position: n.position,
      data: n.data as any,
    })),
    edges: edgesRef.current.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: (e.data || { label: e.label || '' }) as any,
    })),
  }), [viewport]);

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

  // Immediate save (for explicit save actions)
  const saveNow = useCallback(() => {
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
          setNodes(data.nodes.map(n => ({
            id: n.id,
            type: n.type || 'default',
            position: n.position,
            data: n.data,
          })));
          setEdges(data.edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.data?.label,
            data: e.data,
          })));
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

            setNodes(graphData.nodes.map(n => ({
              id: n.id,
              type: n.type || 'default',
              position: n.position,
              data: n.data,
            })));
            setEdges(graphData.edges.map(e => ({
              id: e.id,
              source: e.source,
              target: e.target,
              label: e.data?.label,
              data: e.data,
            })));
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

  return { nodes, edges, viewport, setNodes, setEdges, syncEnabled, saveNow };
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
import { useGraphSync } from './use-graph-sync';
import './graph-view.scss';

const elk = new ELK();

type LayoutAlgorithm = 'layered' | 'stress';

interface GraphViewProps {
  filePath: string;
}

export function GraphView({ filePath }: GraphViewProps) {
  const { nodes, edges, setNodes, setEdges, syncEnabled, saveNow } =
    useGraphSync(filePath);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      // Position changes (drag) trigger sync
      if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
        saveNow();
      }
    },
    [setNodes, saveNow]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges]
  );

  const onConnect: OnConnect = useCallback(
    (params) => {
      const id = `e-${Date.now().toString(36)}`;
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

  const handleAddNode = useCallback(() => {
    const id = `n-${Date.now().toString(36)}`;
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
- Echo prevention (remoteUpdateUntilRef, 500ms)
- CRUD: add node, connect edges, drag positioning
- ELK.js layout toggle (Hierarchical / Force)
- Loading state while fetching"
```

---

## Chunk 4: CLI `vync init --type graph` + Schema Updates

### Task 4: CLI Graph Init

**Files:**
- Modify: `tools/cli/init.ts`
- Modify: `tools/cli/main.ts`
- Test: `tools/cli/__tests__/init.test.ts`

- [ ] **Step 1: Write test for graph init**

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
```

- [ ] **Step 2: Run test — should fail**

```bash
npx vitest run tools/cli/__tests__/init.test.ts
```

Expected: FAIL — `vyncInit` doesn't accept options.

- [ ] **Step 3: Update init.ts**

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

- [ ] **Step 4: Update main.ts to pass --type**

In `tools/cli/main.ts`, replace the existing `case 'init'` block:

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

### Task 5: Update JSON Schemas

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
          "properties": {
            "x": { "type": "number" },
            "y": { "type": "number" }
          },
          "additionalProperties": false
        },
        "data": {
          "type": "object",
          "required": ["label"],
          "properties": {
            "label": { "type": "string" },
            "category": { "type": "string" },
            "description": { "type": "string" },
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
            "label": { "type": "string" },
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
        "nodes": { "type": "array", "items": { "$ref": "#/$defs/GraphNode" } },
        "edges": { "type": "array", "items": { "$ref": "#/$defs/GraphEdge" } }
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

- [ ] **Step 5: Commit**

```bash
git add .vync.schema.json skills/vync-editing/assets/schema.json tools/server/__tests__/fixtures/graph-test.vync
git commit -m "feat(schema): add graph file schema, remove elements shim from fixture"
```

---

## Chunk 5: E2E Verification + Final Tests

### Task 6: Full Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

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
# Create a graph file
node -e "
const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), '.vync');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'test-graph.vync'), JSON.stringify({
  version: 1,
  type: 'graph',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    { id: 'n1', type: 'concept', position: { x: 0, y: 0 }, data: { label: 'Person', category: 'class' } },
    { id: 'n2', type: 'concept', position: { x: 200, y: 0 }, data: { label: 'Employee', category: 'class' } }
  ],
  edges: [
    { id: 'e1', source: 'n2', target: 'n1', data: { label: 'is-a', type: 'inheritance' } }
  ]
}, null, 2));
"
# Open it
npx tsx tools/cli/main.ts open test-graph
```

Verify in browser:
- [ ] GraphView renders (not FileBoard)
- [ ] 2 nodes visible (Person, Employee)
- [ ] 1 edge visible (is-a)
- [ ] "+ Node" button adds a new node
- [ ] Hierarchical/Force layout buttons work
- [ ] Node drag saves position (check server log or file)

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
# Edit the graph file externally (add a node)
node -e "
const fs = require('fs');
const path = require('path');
const f = path.join(process.cwd(), '.vync/test-graph.vync');
const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
data.nodes.push({ id: 'n3', type: 'concept', position: { x: 400, y: 0 }, data: { label: 'Company', category: 'class' } });
fs.writeFileSync(f, JSON.stringify(data, null, 2));
"
```

Verify in browser:
- [ ] New "Company" node appears within ~1 second
- [ ] No console errors

- [ ] **Step 6: Cleanup test file**

```bash
rm -f .vync/test-graph.vync
tmux kill-session -t dev
```

---

### Task 7: Electron Bundle Rebuild

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

### Task 8: Final Commit + Push

- [ ] **Step 1: Run full test suite one final time**

```bash
npx vitest run
npm run build:web
```

Expected: all pass.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/graph-view
```

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| useGraphSync as custom hook, not in GraphView | Separation of concerns; hook is testable independently |
| File type cached in App.tsx state | Avoids re-fetching on tab switch; invalidated by WS file-changed |
| Echo prevention via timestamp (same as FileBoard) | Proven pattern, consistent behavior |
| `elements: []` shim removal | Discriminated union makes shim unnecessary; cleaner types |
| No property panel in this plan | Separate concern, separate plan — keeps this scope focused |
| MiniMap added | Low-cost addition, useful for 10-100 node graphs |
