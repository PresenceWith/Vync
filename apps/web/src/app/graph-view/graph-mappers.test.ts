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
