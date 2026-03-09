export interface VyncViewport {
  zoom: number;
  x: number;
  y: number;
}

// T defaults to unknown for server-side; frontend uses VyncFile<PlaitElement>
export interface VyncFile<T = unknown> {
  version: number;
  viewport: VyncViewport;
  elements: T[];
}

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
