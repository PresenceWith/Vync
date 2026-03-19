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
