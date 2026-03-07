import { useState, useEffect, useRef, useCallback } from 'react';
import { Drawnix } from '@drawnix/drawnix';
import { PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import type { VyncFile, WsMessage } from '@vync/shared';
import localforage from 'localforage';

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';

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

  // Load initial data: try API first, fall back to localforage
  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/sync');
        if (res.ok) {
          const data = (await res.json()) as VyncFile<PlaitElement>;
          setValue({
            children: data.elements || [],
            viewport: data.viewport,
          });
          setSyncMode(true);
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
            setValue({
              children: msg.data.elements || [],
              viewport: msg.data.viewport,
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
    localforage.setItem(MAIN_BOARD_CONTENT_KEY, newValue);
    setValue(newValue);
    if (newValue.children && newValue.children.length > 0) {
      setTutorial(false);
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
