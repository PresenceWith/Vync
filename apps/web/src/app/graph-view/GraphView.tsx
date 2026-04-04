import { useCallback } from 'react';
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react';
import type { GraphNodeData, GraphEdgeData } from '@vync/shared';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled';
import { useGraphSync } from './use-graph-sync';
import './graph-view.scss';

const elk = new ELK();

type LayoutAlgorithm = 'layered' | 'stress';

// Inline ID generator (avoids importing @plait/core into graph module)
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateId(len = 5) {
  return Array.from({ length: len }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');
}

interface GraphViewProps {
  filePath: string;
}

export function GraphView({ filePath }: GraphViewProps) {
  const { nodes, edges, setNodes, setEdges, syncEnabled, saveNow, isRemoteUpdate } =
    useGraphSync(filePath);

  // C-1 fix: check echo guard before triggering sync
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds) as Node<GraphNodeData>[]);
      if (isRemoteUpdate()) return;
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
      setEdges((eds) => applyEdgeChanges(changes, eds) as Edge<GraphEdgeData>[]);
      if (isRemoteUpdate()) return;
      if (changes.some((c) => c.type === 'remove')) {
        saveNow();
      }
    },
    [setEdges, saveNow, isRemoteUpdate]
  );

  const onConnect: OnConnect = useCallback(
    (params) => {
      const id = generateId(5);
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
    const id = generateId(5);
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
