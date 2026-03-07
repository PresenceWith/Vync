import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { WsMessage } from '../shared/types.js';

export function createWsServer(server: Server, port: number) {
  const wss = new WebSocketServer({ noServer: true });

  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(
      request.url!,
      `http://${request.headers.host}`
    );
    if (pathname !== '/ws') return;

    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    console.log('[vync] WebSocket client connected');
    ws.send(JSON.stringify({ type: 'connected' } satisfies WsMessage));

    ws.on('close', () => {
      console.log('[vync] WebSocket client disconnected');
    });
  });

  return {
    broadcast(message: WsMessage) {
      const data = JSON.stringify(message);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    },
    close() {
      wss.close();
    },
  };
}
