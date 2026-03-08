import { useState, useEffect, useRef, useCallback } from 'react';
import { Drawnix } from '@drawnix/drawnix';
import { PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import type { VyncFile, VyncViewport, WsMessage } from '@vync/shared';
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

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const SYNC_DEBOUNCE_MS = 300;

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

export function App() {
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [tutorial, setTutorial] = useState(false);
  const [syncMode, setSyncMode] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteUpdateUntilRef = useRef(0);
  const syncModeRef = useRef(false);

  // Load initial data: try API first, fall back to localforage
  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/sync');
        if (res.ok) {
          const data = (await res.json()) as VyncFile<PlaitElement>;
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

      const storedData = (await localforage.getItem(
        MAIN_BOARD_CONTENT_KEY
      )) as AppValue;
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
  }, []);

  // WebSocket connection for file sync
  useEffect(() => {
    if (!syncMode) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[vync] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage<PlaitElement>;
          if (msg.type === 'file-changed' && msg.data) {
            // Suppress echo for 500ms: setValue may trigger multiple onChange calls
            // (children + fitViewport), so a boolean flag is insufficient
            remoteUpdateUntilRef.current = Date.now() + 500;
            setValue({
              children: msg.data.elements || [],
              viewport: toPlaitViewport(msg.data.viewport),
            });
          }
        } catch (err) {
          console.error('[vync] Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[vync] WebSocket disconnected, reconnecting in 3s...');
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
  }, [syncMode]);

  const handleChange = useCallback((value: unknown) => {
    const newValue = value as AppValue;
    setValue(newValue);

    if (newValue.children && newValue.children.length > 0) {
      setTutorial(false);
    }

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
        const vyncFile: VyncFile<PlaitElement> = {
          version: 1,
          viewport: toVyncViewport(newValue.viewport),
          elements: newValue.children || [],
        };
        fetch('/api/sync', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vyncFile),
        }).catch((err) => {
          console.error('[vync] Failed to sync to server:', err);
        });
      }, SYNC_DEBOUNCE_MS);
    } else {
      // Fallback: save to localforage when not in sync mode
      localforage.setItem(MAIN_BOARD_CONTENT_KEY, newValue);
    }
  }, []);

  return (
    <Drawnix
      value={value.children}
      viewport={value.viewport}
      theme={value.theme}
      onChange={handleChange}
      tutorial={tutorial}
      afterInit={() => {
        console.log('[vync] board initialized');
      }}
    ></Drawnix>
  );
}

export default App;
