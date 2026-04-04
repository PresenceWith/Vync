import { useState, useEffect, useRef, useCallback } from 'react';
import { VyncBoard } from '@vync/board';
import {
  PlaitBoard,
  PlaitElement,
  PlaitNode,
  PlaitTheme,
  Transforms,
  Viewport,
} from '@plait/core';
import type { VyncCanvasFile, VyncViewport, WsMessage } from '@vync/shared';
import localforage from 'localforage';

function toPlaitViewport(v: VyncViewport): Viewport {
  return { zoom: v.zoom, origination: [v.x, v.y] } as Viewport;
}

function toVyncViewport(v?: Viewport): VyncViewport {
  const origination = v?.origination as [number, number] | undefined;
  return {
    zoom: v?.zoom ?? 1,
    x: origination?.[0] ?? 0,
    y: origination?.[1] ?? 0,
  };
}

type BoardValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

const LEGACY_BOARD_CONTENT_KEY = 'main_board_content';
const SYNC_DEBOUNCE_MS = 300;

localforage.config({
  name: 'Vync',
  storeName: 'vync_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

function storageKey(filePath: string): string {
  return `vync_board_${filePath}`;
}

/**
 * Apply external changes (e.g. from Claude Code) to the board via Plait Transforms,
 * so they are recorded in the undo/redo history.
 * Uses ID-based diff: remove → set → insert, all in one synchronous flush cycle
 * so that Cmd+Z undoes the entire external change as a single batch.
 */
function applyExternalChanges(
  board: PlaitBoard,
  newChildren: PlaitElement[]
): void {
  const newById = new Map(newChildren.map((el) => [el.id, el]));
  const newIds = new Set(newChildren.map((el) => el.id));

  // Phase 1: Remove deleted nodes (back-to-front to preserve indices)
  for (let i = board.children.length - 1; i >= 0; i--) {
    if (!newIds.has(board.children[i].id)) {
      Transforms.removeNode(board, [i]);
    }
  }

  // Phase 2: Update modified nodes via board.apply() directly.
  // Transforms.setNode strips null from newProperties, so property deletions
  // would be silently lost. Using board.apply() preserves null → delete semantics.
  for (let i = 0; i < board.children.length; i++) {
    const current = board.children[i];
    const target = newById.get(current.id);
    if (!target) continue;
    const properties: Record<string, unknown> = {};
    const newProperties: Record<string, unknown> = {};
    const allKeys = new Set([...Object.keys(current), ...Object.keys(target)]);
    for (const key of allKeys) {
      if (key === 'id') continue;
      const curVal = (current as Record<string, unknown>)[key];
      const newVal = (target as Record<string, unknown>)[key];
      if (JSON.stringify(curVal) !== JSON.stringify(newVal)) {
        if (curVal !== undefined) properties[key] = curVal;
        newProperties[key] = newVal !== undefined ? newVal : null;
      }
    }
    if (Object.keys(newProperties).length > 0) {
      board.apply({
        type: 'set_node',
        path: [i],
        properties: properties as Partial<PlaitNode>,
        newProperties: newProperties as Partial<PlaitNode>,
      });
    }
  }

  // Phase 3: Insert new nodes so final order matches newChildren exactly.
  // Walk newChildren in order; for each new ID, insert at position i.
  // board.children grows with each insert, but index i stays correct because
  // we process newChildren sequentially and all prior positions are settled.
  const currentIds = new Set(board.children.map((el) => el.id));
  for (let i = 0; i < newChildren.length; i++) {
    if (!currentIds.has(newChildren[i].id)) {
      Transforms.insertNode(board, newChildren[i], [i]);
      currentIds.add(newChildren[i].id);
    }
  }
}

interface FileBoardProps {
  filePath: string;
}

export function FileBoard({ filePath }: FileBoardProps) {
  const [value, setValue] = useState<BoardValue>({ children: [] });
  const [tutorial, setTutorial] = useState(false);
  const [syncMode, setSyncMode] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteUpdateUntilRef = useRef(0);
  const syncModeRef = useRef(false);
  const boardRef = useRef<PlaitBoard | null>(null);

  const fileParam = encodeURIComponent(filePath);
  const boardKey = storageKey(filePath);

  // Load initial data: try API first, fall back to localforage
  useEffect(() => {
    const loadData = async () => {
      // Legacy localStorage migration: copy main_board_content to file-scoped key
      const existingData = await localforage.getItem(boardKey);
      if (!existingData) {
        const legacyData = await localforage.getItem(LEGACY_BOARD_CONTENT_KEY);
        if (legacyData) {
          await localforage.setItem(boardKey, legacyData);
        }
      }

      try {
        let res = await fetch(`/api/sync?file=${fileParam}`);

        // Reconnect recovery: if 404, re-register the file and retry
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
          const data = (await res.json()) as VyncCanvasFile<PlaitElement>;
          setValue({
            children: data.elements || [],
            viewport: toPlaitViewport(data.viewport),
          });
          setSyncMode(true);
          syncModeRef.current = true;
          if (!data.elements || data.elements.length === 0) {
            setTutorial(true);
          }
          return;
        }
      } catch {
        // API not available, fall back to localforage
      }

      const storedData = (await localforage.getItem(boardKey)) as BoardValue;
      if (storedData) {
        setValue(storedData);
        if (storedData.children && storedData.children.length === 0) {
          setTutorial(true);
        }
        return;
      }
      setTutorial(true);
    };
    loadData();
  }, [filePath, fileParam, boardKey]);

  // WebSocket connection for file sync
  useEffect(() => {
    if (!syncMode) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?file=${fileParam}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (import.meta.env.DEV) console.log(`[vync] WebSocket connected for ${filePath}`);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage<PlaitElement>;
          if (
            msg.type === 'file-changed' &&
            msg.data &&
            'elements' in msg.data
          ) {
            const newElements =
              (msg.data as VyncCanvasFile<PlaitElement>).elements || [];
            const board = boardRef.current;

            // Early exit: content identical — nothing to apply
            if (
              board &&
              board.children.length === newElements.length &&
              JSON.stringify(board.children) === JSON.stringify(newElements)
            ) {
              return;
            }

            // Suppress echo: Transforms trigger onChange → handleChange → PUT,
            // so we block outbound sync for 500ms
            remoteUpdateUntilRef.current = Date.now() + 500;

            if (board) {
              // Apply via Transforms so changes are recorded in undo history.
              // All operations run synchronously → Plait batches them into
              // one undo entry (Cmd+Z undoes the entire external change).
              applyExternalChanges(board, newElements);
              // flush → onChange → handleChange → setValue syncs React state
            } else {
              // Board not initialized yet — fall back to direct state update
              setValue((prev) => ({
                ...prev,
                children: newElements,
              }));
            }
          }
        } catch (err) {
          console.error('[vync] Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        if (import.meta.env.DEV) console.log(
          `[vync] WebSocket disconnected for ${filePath}, reconnecting in 3s...`
        );
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on cleanup
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [syncMode, filePath, fileParam]);

  const handleChange = useCallback((value: unknown) => {
    const newValue = value as BoardValue;
    setValue(newValue);

    if (newValue.children && newValue.children.length > 0) {
      setTutorial(false);
    }
  }, []);

  const handleValueChange = useCallback(
    (children: PlaitElement[]) => {
      // Skip sync for remote updates (from WebSocket)
      if (Date.now() < remoteUpdateUntilRef.current) {
        return;
      }

      if (syncModeRef.current) {
        // Debounced PUT to /api/sync
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          const board = boardRef.current;
          const vyncFile: VyncCanvasFile<PlaitElement> = {
            version: 1,
            viewport: toVyncViewport(board?.viewport),
            elements: children || [],
          };
          fetch(`/api/sync?file=${fileParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vyncFile),
          }).catch((err) => {
            console.error('[vync] Failed to sync to server:', err);
          });
        }, SYNC_DEBOUNCE_MS);
      } else {
        // Fallback: save to localforage when not in sync mode
        const board = boardRef.current;
        localforage.setItem(boardKey, {
          children,
          viewport: board?.viewport,
        } as BoardValue);
      }
    },
    [fileParam, boardKey]
  );

  return (
    <VyncBoard
      value={value.children}
      viewport={value.viewport}
      theme={value.theme}
      onChange={handleChange}
      onValueChange={handleValueChange}
      tutorial={tutorial}
      afterInit={(board) => {
        boardRef.current = board;
        if (import.meta.env.DEV) console.log(`[vync] board initialized for ${filePath}`);
      }}
    ></VyncBoard>
  );
}
