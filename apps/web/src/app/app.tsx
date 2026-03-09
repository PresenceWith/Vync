import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FileBoard } from './file-board';
import { TabBar } from './tab-bar';
import { computeLabels } from './tab-utils';
import type { TabInfo } from './tab-utils';

const initialFile = new URLSearchParams(window.location.search).get('file');

function NoFileView() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center', color: '#666' }}>
        <h2>No file selected</h2>
        <p>Use <code>vync open &lt;file&gt;</code> to start.</p>
      </div>
    </div>
  );
}

export function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [registeredFiles, setRegisteredFiles] = useState<string[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Hub WebSocket
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === 'connected' && msg.data?.files) {
          const files: string[] = msg.data.files;
          setRegisteredFiles(files);
          const newTabs = computeLabels(files);
          setTabs(newTabs);
          setActiveFilePath((prev) => prev || initialFile || files[0] || null);
        }

        if (msg.type === 'hub-file-registered') {
          setRegisteredFiles((prev) => [...new Set([...prev, msg.filePath])]);
          setTabs((prev) => {
            if (prev.some((t) => t.filePath === msg.filePath)) return prev;
            const allPaths = [...prev.map((t) => t.filePath), msg.filePath];
            return computeLabels(allPaths);
          });
        }

        if (msg.type === 'hub-file-unregistered') {
          setRegisteredFiles((prev) => prev.filter((f) => f !== msg.filePath));
          setTabs((prev) => {
            const next = prev.filter((t) => t.filePath !== msg.filePath);
            return computeLabels(next.map((t) => t.filePath));
          });
          setActiveFilePath((prev) => {
            if (prev !== msg.filePath) return prev;
            const remaining = tabsRef.current.filter((t) => t.filePath !== msg.filePath);
            return remaining[0]?.filePath || null;
          });
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // URL sync
  useEffect(() => {
    if (activeFilePath) {
      const url = new URL(window.location.href);
      url.searchParams.set('file', activeFilePath);
      history.replaceState(null, '', url.toString());
    }
  }, [activeFilePath]);

  // Labels are recomputed when tabs change via setTabs(computeLabels(...))
  const tabsWithLabels = tabs;

  const handleTabClose = useCallback((filePath: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.filePath !== filePath);
      return computeLabels(next.map((t) => t.filePath));
    });
    setActiveFilePath((prev) => {
      if (prev !== filePath) return prev;
      const remaining = tabsRef.current.filter((t) => t.filePath !== filePath);
      return remaining[0]?.filePath || null;
    });
  }, []);

  const handleAddFile = useCallback((filePath: string) => {
    setTabs((prev) => {
      if (prev.some((t) => t.filePath === filePath)) return prev;
      const allPaths = [...prev.map((t) => t.filePath), filePath];
      return computeLabels(allPaths);
    });
    setActiveFilePath(filePath);
  }, []);

  const hasContent = tabs.length > 0 || activeFilePath;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TabBar
        tabs={tabsWithLabels}
        activeFilePath={activeFilePath}
        registeredFiles={registeredFiles}
        onTabClick={setActiveFilePath}
        onTabClose={handleTabClose}
        onAddFile={handleAddFile}
      />
      {activeFilePath ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FileBoard key={activeFilePath} filePath={activeFilePath} />
        </div>
      ) : (
        <NoFileView />
      )}
    </div>
  );
}

export default App;
