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
