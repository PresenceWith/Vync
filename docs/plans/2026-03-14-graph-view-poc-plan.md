# Graph View PoC Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that React Flow v12 + ELK.js work in Vync's React 19 + Vite 6 environment, and that graph-type .vync files pass through the existing sync pipeline with zero regression.

**Architecture:** Two isolated PoCs on a single feature branch. PoC-A creates a standalone GraphView component with hardcoded data (no existing code changes). PoC-B adds minimal server/hook/diff guards for graph file compatibility using a shim approach (`elements: []` included in graph files).

**Tech Stack:** React Flow v12 (`@xyflow/react`), ELK.js (`elkjs/lib/elk.bundled.js` pure JS), Vite 6, React 19, TypeScript, Vitest

**Spec:** `docs/plans/2026-03-14-graph-view-poc.md`

---

## File Map

### New files (PoC-A)
| File | Responsibility |
|------|---------------|
| `apps/web/src/app/graph-view/GraphView.tsx` | React Flow instance + ELK.js layout toggle, controlled component pattern |
| `apps/web/src/app/graph-view/graph-view.scss` | GraphView container styles (dimensions, isolation) |

### Modified files (PoC-B)
| File | Lines | Change |
|------|-------|--------|
| `tools/server/server.ts` | 200-204 | Type-based PUT validation branch |
| `hooks/hooks.json` | 9 | Type guard in PostToolUse inline validator |
| `skills/vync-editing/scripts/validate.js` | 84-108 | Type guard: skip PlaitElement validation for graph files |
| `tools/cli/diff.ts` | 326-327 | Early return guard for graph files |

### Test fixtures (PoC-B)
| File | Responsibility |
|------|---------------|
| `tools/server/__tests__/fixtures/graph-test.vync` | Shim-format graph file for testing |

---

## Chunk 1: Pre-flight + PoC-A (React Flow + ELK.js)

### Task 0: Branch Setup + Pre-flight Checks

**Files:** None (terminal only)

- [ ] **Step 1: Create feature branch**

```bash
git checkout develop && git pull
git checkout -b feat/graph-view-poc
```

- [ ] **Step 2: Pre-flight — React Flow peer deps**

```bash
npm info @xyflow/react peerDependencies
```

Expected: `{ react: '>=17', 'react-dom': '>=17' }` — React 19.2.0 is within range.
**STOP if:** peer dep requires React < 19. → No-Go.

- [ ] **Step 3: Pre-flight — dry-run install**

```bash
npm install --dry-run @xyflow/react elkjs 2>&1 | grep -i "ERR\|WARN.*peer"
```

Expected: no peer dep errors.
**STOP if:** unresolvable peer dep conflict. → Try `--legacy-peer-deps`, document result.

- [ ] **Step 4: Pre-flight — .elements access audit**

```bash
grep -rn '\.elements' --include='*.ts' --include='*.tsx' --include='*.js' \
  tools/ apps/ packages/shared/ packages/board/ skills/ | grep -v node_modules | grep -v dist
```

Expected: ~17 occurrences across ~10 files. Save output as reference for §8-2.
This is informational only — no action needed.

---

### Task 1: Install Dependencies (Scenario A-1)

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Install packages**

```bash
npm install @xyflow/react elkjs
```

Expected: clean install, no peer dep errors.

- [ ] **Step 2: Verify build still works**

```bash
npm run build:web
```

Expected: build succeeds (React Flow + ELK.js tree-shaken out since nothing imports them yet).

- [ ] **Step 3: Verify tests still pass**

```bash
npm test
```

Expected: all 95 tests pass. Zero regression from adding dependencies.

- [ ] **Step 4: Record A-1 result**

If all above pass → `A-1: PASS`. Note any warnings for the PoC results document.

---

### Task 2: Create GraphView Component (Scenario A-2)

**Files:**
- Create: `apps/web/src/app/graph-view/GraphView.tsx`
- Create: `apps/web/src/app/graph-view/graph-view.scss`

- [ ] **Step 1: Create directory**

```bash
ls apps/web/src/app/
```

Verify `graph-view/` does not exist yet.

- [ ] **Step 2: Create GraphView styles**

Create `apps/web/src/app/graph-view/graph-view.scss`:

```scss
.graph-view-container {
  width: 100%;
  height: 100%;
}

.graph-view-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  gap: 4px;

  button {
    padding: 4px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 12px;

    &.active {
      background: #1a73e8;
      color: white;
      border-color: #1a73e8;
    }
  }
}
```

- [ ] **Step 3: Create GraphView component**

Create `apps/web/src/app/graph-view/GraphView.tsx`:

```tsx
import { useState, useCallback } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
  Background,
  Controls,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled';
import './graph-view.scss';

// Note: If TypeScript cannot resolve elkjs types, try one of:
// - import ELK from 'elkjs/lib/elk.bundled.js'
// - Add `declare module 'elkjs/lib/elk.bundled'` to a .d.ts file

const elk = new ELK();

const initialNodes: Node[] = [
  {
    id: 'person',
    type: 'default',
    position: { x: 0, y: 0 },
    data: { label: 'Person (class)' },
  },
  {
    id: 'employee',
    type: 'default',
    position: { x: 0, y: 100 },
    data: { label: 'Employee (class)' },
  },
  {
    id: 'company',
    type: 'default',
    position: { x: 200, y: 100 },
    data: { label: 'Company (class)' },
  },
  {
    id: 'name-prop',
    type: 'default',
    position: { x: -200, y: 100 },
    data: { label: 'name (property)' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e-isa', source: 'employee', target: 'person', label: 'is-a' },
  { id: 'e-works', source: 'employee', target: 'company', label: 'works-at' },
  { id: 'e-has', source: 'person', target: 'name-prop', label: 'has' },
];

type LayoutAlgorithm = 'layered' | 'stress';

async function computeLayout(
  nodes: Node[],
  edges: Edge[],
  algorithm: LayoutAlgorithm
): Promise<Node[]> {
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': algorithm === 'layered'
        ? 'org.eclipse.elk.layered'
        : 'org.eclipse.elk.stress',
      'elk.spacing.nodeNode': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: 150,
      height: 40,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const layout = await elk.layout(elkGraph);

  return nodes.map((node) => {
    const elkNode = layout.children?.find((n) => n.id === node.id);
    return {
      ...node,
      position: {
        x: elkNode?.x ?? node.position.x,
        y: elkNode?.y ?? node.position.y,
      },
    };
  });
}

export function GraphView() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges] = useState<Edge[]>(initialEdges);
  const [activeLayout, setActiveLayout] = useState<LayoutAlgorithm>('layered');

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // edges are static in PoC — no-op for now
      void changes;
    },
    []
  );

  const handleLayout = useCallback(
    async (algorithm: LayoutAlgorithm) => {
      setActiveLayout(algorithm);
      const layouted = await computeLayout(nodes, edges, algorithm);
      setNodes(layouted);
    },
    [nodes, edges]
  );

  return (
    <div className="graph-view-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
      <div className="graph-view-controls">
        <button
          className={activeLayout === 'layered' ? 'active' : ''}
          onClick={() => handleLayout('layered')}
        >
          Hierarchical
        </button>
        <button
          className={activeLayout === 'stress' ? 'active' : ''}
          onClick={() => handleLayout('stress')}
        >
          Force
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add a temporary dev route to test GraphView**

Temporarily modify `apps/web/src/app/app.tsx` — add an import and a keyboard shortcut to toggle GraphView for testing. This avoids changing the real routing logic during PoC-A.

At the top of `app.tsx`, add:

```tsx
import { GraphView } from './graph-view/GraphView';
```

After the existing state declarations (after line 36), add:

```tsx
const [showGraph, setShowGraph] = useState(false);
```

Add a **new, separate `useEffect`** after the URL sync effect (after line 104):

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'g' && e.ctrlKey && e.shiftKey) {
      setShowGraph(prev => !prev);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

In the render, replace **only lines 175-181** (the `{activeFilePath ? ... : <NoFileView />}` block). Keep `<TabBar>` above it unchanged:

```tsx
{/* Replace lines 175-181 only — TabBar above stays intact */}
{showGraph ? (
  <div style={{ flex: 1, overflow: 'hidden' }}>
    <GraphView />
  </div>
) : activeFilePath ? (
  <div style={{ flex: 1, overflow: 'hidden' }}>
    <FileBoard key={activeFilePath} filePath={activeFilePath} />
  </div>
) : (
  <NoFileView />
)}
```

**Note:** This temporary toggle (Ctrl+Shift+G) is for PoC testing only. It will be removed after PoC-A verification and replaced by proper type-based routing in the implementation phase.

- [ ] **Step 5: Verify dev server renders GraphView (A-2)**

```bash
npm run dev:server
```

1. Open `http://localhost:3100` in browser
2. Press `Ctrl+Shift+G` to toggle GraphView
3. Verify:
   - [ ] 4 nodes visible with labels (Person, Employee, Company, name)
   - [ ] 3 edges visible with labels (is-a, works-at, has)
   - [ ] Nodes are draggable
   - [ ] No console errors (open DevTools → Console)
   - [ ] React Flow container fills the available space

**A-2 PASS** if all checks above succeed.

---

### Task 3: Verify ELK.js Layout Toggle (Scenario A-3)

**Files:** None (manual verification of Task 2 code)

- [ ] **Step 1: Test Hierarchical layout**

1. With GraphView visible in browser, click **"Hierarchical"** button
2. Observe node repositioning
3. Verify: nodes arranged in layers (top-to-bottom or left-to-right), no overlapping

- [ ] **Step 2: Test Force layout**

1. Click **"Force"** button
2. Observe node repositioning — positions should differ from Hierarchical
3. Verify: at least 2 nodes moved >50px from their Hierarchical positions

- [ ] **Step 3: Toggle back and forth**

1. Click Hierarchical → Force → Hierarchical
2. Verify: layout is deterministic (Hierarchical always produces same arrangement)
3. Verify: no console errors during transitions

**A-3 PASS** if layout toggles work without errors and produce visually distinct arrangements.

---

### Task 4: Production Build + CSS Check (Scenarios A-4, A-5)

**Files:** None (build verification)

- [ ] **Step 1: Production build (A-4)**

```bash
npm run build:web
```

Expected: build succeeds with no errors.

- [ ] **Step 2: Verify React Flow + ELK.js in bundle**

```bash
ls -la dist/apps/web/assets/*.js | head -5
```

Verify the JS bundle exists and is larger than before (React Flow + ELK.js included).

- [ ] **Step 3: CSS conflict check (A-5)**

1. Open `http://localhost:3100` with dev server running
2. Toggle to GraphView (Ctrl+Shift+G)
3. Open DevTools → Elements
4. Check `.react-flow` container: verify no unexpected styles from Plait
5. Toggle back to canvas (Ctrl+Shift+G again)
6. Verify: Plait canvas renders correctly (no React Flow CSS bleed)
7. Verify: no z-index conflicts, no overflow issues

**A-4 PASS** if build succeeds. **A-5 PASS** if no CSS conflicts found.

- [ ] **Step 4: Commit PoC-A**

```bash
git add package.json package-lock.json apps/web/src/app/graph-view/ apps/web/src/app/app.tsx
git commit -m "poc(graph): React Flow + ELK.js environment integration (PoC-A)

- Install @xyflow/react and elkjs
- Create GraphView with 4 hardcoded nodes + 3 edges
- ELK.js layout toggle (Hierarchical ↔ Stress)
- Temporary Ctrl+Shift+G toggle for testing
- Validates: R-1 (React 19 compat), R-2 (ELK.js), R-3 (CSS isolation)"
```

---

### Task 5: PoC-A Go/No-Go Decision

**Files:** None (decision point)

- [ ] **Step 1: Record results**

| Scenario | Result | Notes |
|----------|--------|-------|
| A-1 | PASS/FAIL | |
| A-2 | PASS/FAIL | |
| A-3 | PASS/FAIL | |
| A-4 | PASS/FAIL | |
| A-5 | PASS/FAIL | |

- [ ] **Step 2: Decision**

- **All PASS** → proceed to Chunk 2 (PoC-B)
- **Any FAIL** → check "실패 시 대안" table in spec §4. Apply alternative and re-test, or declare No-Go.
- **STOP HERE if No-Go.** Skip Chunk 2. Go to Rollback (Task 11).

---

## Chunk 2: PoC-B (Server Compatibility)

### Task 6: Server PUT Validation Branch (Scenario B-1, B-2)

**Files:**
- Modify: `tools/server/server.ts:200-204`

- [ ] **Step 1: Modify server validation**

In `tools/server/server.ts`, replace lines 200-204:

```typescript
// BEFORE:
const data = req.body as VyncFile;
if (!data || !Array.isArray(data.elements)) {
  res.status(400).json({ error: 'Invalid VyncFile format' });
  return;
}
```

```typescript
// AFTER:
const data = req.body as VyncFile;
if (!data) {
  res.status(400).json({ error: 'Invalid VyncFile format' });
  return;
}
if (data.type === 'graph') {
  // Graph files: validate nodes and edges arrays
  const gd = data as Record<string, unknown>;
  if (!Array.isArray(gd.nodes) || !Array.isArray(gd.edges)) {
    res.status(400).json({ error: 'Graph file requires nodes and edges arrays' });
    return;
  }
} else {
  // Canvas files (default): validate elements array
  if (!Array.isArray(data.elements)) {
    res.status(400).json({ error: 'Invalid VyncFile format' });
    return;
  }
}
```

- [ ] **Step 2: Create graph test fixture**

Create `tools/server/__tests__/fixtures/graph-test.vync`:

```json
{
  "version": 1,
  "type": "graph",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "elements": [],
  "nodes": [
    {
      "id": "person",
      "type": "concept",
      "position": { "x": 100, "y": 200 },
      "data": { "label": "Person", "category": "class" }
    },
    {
      "id": "employee",
      "type": "concept",
      "position": { "x": 300, "y": 200 },
      "data": { "label": "Employee", "category": "class" }
    }
  ],
  "edges": [
    {
      "id": "e-isa",
      "source": "employee",
      "target": "person",
      "data": { "label": "is-a", "type": "inheritance" }
    }
  ]
}
```

- [ ] **Step 3: Run existing tests (B-3)**

```bash
npm test
```

Expected: all 95 tests pass. The server.ts change should not break any existing test because all existing tests use canvas files with `elements: []`.

- [ ] **Step 4: Manual PUT test — graph file (B-1)**

Start the server and register a graph file:

```bash
# Terminal 1: start server
npm run dev:server

# Terminal 2: register + PUT graph file
curl -s -X POST http://localhost:3100/api/files \
  -H "Content-Type: application/json" \
  -d '{"filePath":"'"$(pwd)/tools/server/__tests__/fixtures/graph-test.vync"'"}'

curl -s -X PUT "http://localhost:3100/api/sync?file=$(pwd)/tools/server/__tests__/fixtures/graph-test.vync" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"type":"graph","viewport":{"x":0,"y":0,"zoom":1},"elements":[],"nodes":[{"id":"test","type":"concept","position":{"x":0,"y":0},"data":{"label":"Test"}}],"edges":[]}'
```

Expected: `{"ok":true}` (HTTP 200).
**B-1 PASS** if 200 response.

- [ ] **Step 5: Manual PUT test — canvas file (B-2)**

```bash
# Create a temp canvas file
echo '{"version":1,"viewport":{"x":0,"y":0,"zoom":1},"elements":[]}' > /tmp/test-canvas.vync

curl -s -X POST http://localhost:3100/api/files \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/tmp/test-canvas.vync"}'

curl -s -X PUT "http://localhost:3100/api/sync?file=/tmp/test-canvas.vync" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"viewport":{"x":0,"y":0,"zoom":1},"elements":[]}'
```

Expected: `{"ok":true}` (HTTP 200). Canvas PUT still works as before.
**B-2 PASS** if 200 response.

---

### Task 7: PostToolUse Hook Type Guard (Scenario B-5)

**Files:**
- Modify: `hooks/hooks.json:9`
- Modify: `skills/vync-editing/scripts/validate.js:84-108`

- [ ] **Step 1: Update inline hook validator**

In `hooks/hooks.json`, find the inline Node.js script on line 9. The key change: after parsing JSON, check `d.type === 'graph'` and skip canvas-specific validation.

Replace the entire `command` value on line 9. The new command adds a graph type guard after parsing:

Find in the inline script:
```
if(!Array.isArray(d.elements))e.push('elements must be array');
```

Replace with:
```
if(d.type==='graph'){if(!Array.isArray(d.nodes))e.push('nodes must be array');if(!Array.isArray(d.edges))e.push('edges must be array')}else{if(!Array.isArray(d.elements))e.push('elements must be array')}
```

The full updated command string for line 9:

```
"command": "jq -r '.tool_input.file_path // \"\"' | { read f; [[ \"$f\" == *.vync ]] && node -e \"const fs=require('fs'),p=process.argv[1];try{const d=JSON.parse(fs.readFileSync(p,'utf8'));const e=[];if(typeof d.version!=='number')e.push('missing version');if(!d.viewport||typeof d.viewport!=='object')e.push('missing viewport');else{if(typeof d.viewport.zoom!=='number')e.push('viewport.zoom');if(typeof d.viewport.x!=='number')e.push('viewport.x');if(typeof d.viewport.y!=='number')e.push('viewport.y')}if(d.type==='graph'){if(!Array.isArray(d.nodes))e.push('nodes must be array');if(!Array.isArray(d.edges))e.push('edges must be array')}else{if(!Array.isArray(d.elements))e.push('elements must be array')}if(e.length){console.error('[vync-validate] '+p+': '+e.join(', '));process.exit(1)}console.log('[vync-validate] '+p+': OK')}catch(err){console.error('[vync-validate] '+p+': '+err.message);process.exit(1)}\" \"$f\" 2>&1 || true; }"
```

- [ ] **Step 2: Update standalone validate.js**

In `skills/vync-editing/scripts/validate.js`, replace lines 84-108:

```javascript
// BEFORE:
  if (!Array.isArray(data.elements)) {
    errors.push('"elements" must be an array');
  } else {
    // ... element ID/shape validation
    collectIds(data.elements, '');
  }

// AFTER:
  if (data.type === 'graph') {
    // Graph files: validate nodes and edges
    if (!Array.isArray(data.nodes)) {
      errors.push('"nodes" must be an array for graph files');
    }
    if (!Array.isArray(data.edges)) {
      errors.push('"edges" must be an array for graph files');
    }
  } else {
    // Canvas files: validate elements (existing logic)
    if (!Array.isArray(data.elements)) {
      errors.push('"elements" must be an array');
    } else {
      const ids = new Set();
      function collectIds(elements, prefix) {
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const loc = prefix ? `${prefix}.children[${i}]` : `elements[${i}]`;
          if (!el.id || typeof el.id !== 'string') {
            errors.push(`${loc}: missing or invalid "id"`);
          } else {
            if (ids.has(el.id)) errors.push(`duplicate id: "${el.id}"`);
            ids.add(el.id);
          }
          if (el.type === 'geometry' && el.shape && !validShapes.has(el.shape)) {
            errors.push(
              `${loc}: invalid shape "${el.shape}" (must be camelCase, e.g. "multiDocument" not "multi-document")`
            );
          }
          if (Array.isArray(el.children)) collectIds(el.children, loc);
        }
      }
      collectIds(data.elements, '');
    }
  }
```

- [ ] **Step 3: Verify hook with graph file (B-5)**

```bash
node skills/vync-editing/scripts/validate.js tools/server/__tests__/fixtures/graph-test.vync
```

Expected: `[vync-validate] .../graph-test.vync: OK`
**B-5 PASS** if OK output, no errors.

- [ ] **Step 4: Verify hook still works with canvas files**

```bash
node skills/vync-editing/scripts/validate.js /tmp/test-canvas.vync
```

Expected: `[vync-validate] .../test-canvas.vync: OK`

---

### Task 8: diff.ts Graph File Guard (Scenario B-6)

**Files:**
- Modify: `tools/cli/diff.ts:326-327`

- [ ] **Step 1: Add graph file guard**

In `tools/cli/diff.ts`, after line 326 (`const currentData = JSON.parse(currentRaw);`), add:

```typescript
  // Guard: graph files are not yet supported by diff
  if (currentData.type === 'graph') {
    return {
      tree: `[${fileName}] Graph files are not yet supported by diff`,
      changes: [],
      snapshotUpdated: false,
    };
  }
```

This goes right after `const currentData = JSON.parse(currentRaw);` (line 326) and before `const currentElements = currentData.elements || [];` (line 327).

- [ ] **Step 2: Run diff tests**

```bash
npx vitest run tools/cli/__tests__/diff.test.ts
```

Expected: all diff tests pass (they use canvas files, not graph files).

- [ ] **Step 3: Manual graph diff test (B-6)**

```bash
npx tsx -e "
const { vyncDiff } = await import('./tools/cli/diff.ts');
const result = await vyncDiff('tools/server/__tests__/fixtures/graph-test.vync');
console.log(result.tree);
console.log('snapshotUpdated:', result.snapshotUpdated);
"
```

Expected output:
```
[graph-test.vync] Graph files are not yet supported by diff
snapshotUpdated: false
```

Verify: no `.lastread` file created next to `graph-test.vync`:
```bash
ls tools/server/__tests__/fixtures/graph-test.vync.lastread 2>/dev/null && echo "FAIL: .lastread created" || echo "PASS: no .lastread"
```

**B-6 PASS** if "not yet supported" message and no `.lastread` file.

---

### Task 9: WebSocket Sync Verification (Scenario B-4)

**Files:** None (manual verification)

- [ ] **Step 1: Start server and register graph file**

```bash
# Terminal 1: start server
npm run dev:server

# Terminal 2: register graph file
curl -s -X POST http://localhost:3100/api/files \
  -H "Content-Type: application/json" \
  -d '{"filePath":"'"$(pwd)/tools/server/__tests__/fixtures/graph-test.vync"'"}'
```

- [ ] **Step 2: Subscribe to WebSocket**

```bash
# Terminal 3: connect wscat (install if needed: npm install -g wscat)
npx wscat -c "ws://localhost:3100/ws?file=$(pwd)/tools/server/__tests__/fixtures/graph-test.vync"
```

Expected: connected, receives `{"type":"connected",...}` message.

- [ ] **Step 3: Modify graph file externally**

```bash
# Terminal 4: edit graph file (change a node label)
cat tools/server/__tests__/fixtures/graph-test.vync | \
  sed 's/"Person"/"Human"/' > /tmp/graph-update.json && \
  mv /tmp/graph-update.json tools/server/__tests__/fixtures/graph-test.vync
```

- [ ] **Step 4: Verify WS message received**

In Terminal 3 (wscat), verify a `file-changed` message was received containing:
- `"type":"file-changed"`
- `"nodes"` array in the data
- `"edges"` array in the data
- The modified label (`"Human"` instead of `"Person"`)

**B-4 PASS** if WS message received with correct graph JSON structure.

- [ ] **Step 5: Restore fixture file**

```bash
cd /Users/presence/projects/Vync
git checkout -- tools/server/__tests__/fixtures/graph-test.vync
```

---

### Task 10: Full Test Suite + Commit (Scenario B-3)

**Files:** None (verification + commit)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all 95 tests PASS. Zero regression.
**B-3 PASS** if all tests pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit PoC-B**

```bash
git add tools/server/server.ts hooks/hooks.json skills/vync-editing/scripts/validate.js tools/cli/diff.ts tools/server/__tests__/fixtures/graph-test.vync
git commit -m "poc(graph): server compatibility with shim approach (PoC-B)

- Server PUT validation: type-based branch (graph: nodes+edges, canvas: elements)
- PostToolUse hook: type guard for graph files
- validate.js: type guard for graph files
- diff.ts: early return guard for graph files
- Add graph-test.vync fixture
- Validates: R-4 (server PUT), R-5 (hook), R-6 (diff guard)"
```

---

### Task 11: Go/No-Go Decision + Cleanup

**Files:**
- Modify: `docs/plans/2026-03-14-graph-view-poc.md` (record results)

- [ ] **Step 1: Record PoC-B results**

| Scenario | Result | Notes |
|----------|--------|-------|
| B-1 | PASS/FAIL | |
| B-2 | PASS/FAIL | |
| B-3 | PASS/FAIL | |
| B-4 | PASS/FAIL | |
| B-5 | PASS/FAIL | |
| B-6 | PASS/FAIL | |

- [ ] **Step 2: Overall Go/No-Go**

| PoC | Result |
|-----|--------|
| PoC-A (A-1~A-5) | PASS/FAIL |
| PoC-B (B-1~B-6) | PASS/FAIL |
| **Overall** | **Go / Conditional Go / No-Go** |

- [ ] **Step 3: If Go — clean up temporary dev route**

Remove the temporary `Ctrl+Shift+G` toggle from `app.tsx`:
- Remove the `import { GraphView }` (will be re-added in implementation phase with proper routing)
- Remove the `showGraph` state
- Remove the keyboard event listener `useEffect`
- Remove the `GraphView` conditional render
- Restore the original `{activeFilePath ? <FileBoard .../> : <NoFileView />}` block

```bash
git add apps/web/src/app/app.tsx
git commit -m "poc(graph): remove temporary dev toggle, keep GraphView component"
```

- [ ] **Step 4: If No-Go — rollback**

```bash
git checkout develop
git branch -D feat/graph-view-poc
```

Document reason in `docs/plans/2026-03-14-graph-view-poc.md` under a new "## Results" section.

- [ ] **Step 5: Update PoC spec with results**

Add a `## Results` section to `docs/plans/2026-03-14-graph-view-poc.md` with:
- Each scenario result (PASS/FAIL + notes)
- Overall judgment (Go/Conditional Go/No-Go)
- Any Conditional Go alternatives applied
- Date of execution

- [ ] **Step 6: Push branch (if Go)**

```bash
git push -u origin feat/graph-view-poc
```
