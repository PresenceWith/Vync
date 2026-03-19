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
