import { useState, useEffect, useRef, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { VyncGraphFile, VyncViewport, GraphNodeData, GraphEdgeData } from '@vync/shared';

const SYNC_DEBOUNCE_MS = 300;

interface WsMsg {
  type: string;
  data?: { type?: string; nodes?: unknown[]; edges?: unknown[]; viewport?: VyncViewport };
}

interface UseGraphSyncResult {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
  viewport: VyncViewport;
  setNodes: React.Dispatch<React.SetStateAction<Node<GraphNodeData>[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge<GraphEdgeData>[]>>;
  syncEnabled: boolean;
  saveNow: () => void;
  isRemoteUpdate: () => boolean;
}

// Import dynamically to avoid pulling @vync/shared barrel (node:crypto) into browser
function mapToReactFlowNodes(vyncNodes: VyncGraphFile['nodes']): Node<GraphNodeData>[] {
  return vyncNodes.map((n) => ({
    id: n.id,
    type: n.type || 'default',
    position: n.position,
    data: n.data,
  }));
}

function mapToReactFlowEdges(vyncEdges: VyncGraphFile['edges']): Edge<GraphEdgeData>[] {
  return vyncEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.data?.label,
    data: e.data,
  }));
}

export function useGraphSync(filePath: string): UseGraphSyncResult {
  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<GraphEdgeData>[]>([]);
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

  const isRemoteUpdate = useCallback(
    () => Date.now() < remoteUpdateUntilRef.current,
    []
  );

  // Build VyncGraphFile from current state (uses refs to avoid stale closures)
  const buildFile = useCallback((): VyncGraphFile => ({
    version: 1,
    type: 'graph',
    viewport: viewportRef.current,
    nodes: nodesRef.current.map((n) => ({
      id: n.id,
      type: n.type || 'concept',
      position: n.position,
      data: n.data,
    })),
    edges: edgesRef.current.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: e.data || { label: '' },
    })),
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
    if (Date.now() < remoteUpdateUntilRef.current) return;
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
          setNodes(mapToReactFlowNodes(data.nodes));
          setEdges(mapToReactFlowEdges(data.edges));
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
          const msg = JSON.parse(event.data) as WsMsg;
          if (msg.type === 'file-changed' && msg.data && 'nodes' in msg.data) {
            const graphData = msg.data as VyncGraphFile;

            // Echo guard
            remoteUpdateUntilRef.current = Date.now() + 500;

            setNodes(mapToReactFlowNodes(graphData.nodes));
            setEdges(mapToReactFlowEdges(graphData.edges));
            setViewport(graphData.viewport);
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
