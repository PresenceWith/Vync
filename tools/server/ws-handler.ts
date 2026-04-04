import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { WsMessage } from '@vync/shared';
import type { FileRegistry } from './file-registry.js';

export function createWsServer(
  server: Server,
  port: number,
  registry: FileRegistry
) {
  const wss = new WebSocketServer({ noServer: true });
  const clientFiles = new Map<WebSocket, string>();

  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') return;

    // Strict origin check — skip for port 0 (tests)
    const origin = request.headers.origin;
    if (port > 0 && (!origin || !allowedOrigins.includes(origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const filePath = url.searchParams.get('file');

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, filePath);
    });
  });

  wss.on(
    'connection',
    (ws: WebSocket, _request: IncomingMessage, filePath: string | null) => {
      if (!filePath) {
        // Hub mode: client receives file registration/unregistration events
        registry.addHubClient(ws);
        ws.send(
          JSON.stringify({
            type: 'connected',
            data: { files: registry.listFiles() },
          } satisfies WsMessage)
        );

        ws.on('close', () => {
          registry.removeHubClient(ws);
        });
        return;
      }

      // Check if file is registered
      if (!registry.getSync(filePath)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'FILE_NOT_FOUND',
          } satisfies WsMessage)
        );
        ws.close(4404, 'File not registered');
        return;
      }

      clientFiles.set(ws, filePath);
      registry.addClient(filePath, ws);

      console.log(`[vync] WS client connected: ${filePath}`);
      ws.send(
        JSON.stringify({ type: 'connected', filePath } satisfies WsMessage)
      );

      ws.on('close', () => {
        const fp = clientFiles.get(ws);
        if (fp) {
          registry.removeClient(fp, ws);
          clientFiles.delete(ws);
        }
        console.log('[vync] WS client disconnected');
      });
    }
  );

  return {
    close() {
      wss.clients.forEach((client) => client.terminate());
      wss.close();
    },
  };
}
