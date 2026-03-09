import { FileBoard } from './file-board';

export function App() {
  const filePath = new URLSearchParams(window.location.search).get('file');

  if (!filePath) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center', color: '#666' }}>
          <h2>No file specified</h2>
          <p>Use <code>vync open &lt;file&gt;</code> to start.</p>
        </div>
      </div>
    );
  }

  return <FileBoard filePath={filePath} />;
}

export default App;
