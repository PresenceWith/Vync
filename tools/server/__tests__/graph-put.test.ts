import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('Graph file PUT/GET roundtrip', () => {
  const tmpDir = path.join(os.tmpdir(), `graph-put-test-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) {
      await shutdownFn();
      shutdownFn = null;
    }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('accepts graph file PUT and returns same data on GET', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const graphFile = path.join(tmpDir, 'test.vync');
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        version: 1,
        type: 'graph',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: 'n1',
            type: 'concept',
            position: { x: 0, y: 0 },
            data: { label: 'Initial' },
          },
        ],
        edges: [],
      })
    );
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({
      initialFile: graphFile,
      port,
      mode: 'production',
    });
    shutdownFn = result.shutdown;

    const realPath = await fs.realpath(graphFile);

    // PUT updated graph data
    const graphPayload = {
      version: 1,
      type: 'graph',
      viewport: { x: 10, y: 20, zoom: 2 },
      nodes: [
        {
          id: 'n1',
          type: 'concept',
          position: { x: 100, y: 200 },
          data: { label: 'Person', category: 'class' },
        },
        {
          id: 'n2',
          type: 'concept',
          position: { x: 300, y: 200 },
          data: { label: 'Employee' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n2',
          target: 'n1',
          data: { label: 'is-a', type: 'inheritance' },
        },
      ],
    };

    const putRes = await fetch(
      `http://localhost:${port}/api/sync?file=${encodeURIComponent(realPath)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graphPayload),
      }
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);

    // GET should return the updated data
    await new Promise((r) => setTimeout(r, 100));
    const getRes = await fetch(
      `http://localhost:${port}/api/sync?file=${encodeURIComponent(realPath)}`
    );
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.type).toBe('graph');
    expect(getData.nodes).toHaveLength(2);
    expect(getData.edges).toHaveLength(1);
    expect(getData.nodes[0].data.label).toBe('Person');
  });

  it('rejects graph file exceeding node limit', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const graphFile = path.join(tmpDir, 'big.vync');
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        version: 1,
        type: 'graph',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
      })
    );
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({
      initialFile: graphFile,
      port,
      mode: 'production',
    });
    shutdownFn = result.shutdown;

    const realPath = await fs.realpath(graphFile);

    const bigPayload = {
      version: 1,
      type: 'graph',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: Array.from({ length: 2001 }, (_, i) => ({
        id: `n${i}`,
        type: 'concept',
        position: { x: 0, y: 0 },
        data: { label: `Node ${i}` },
      })),
      edges: [],
    };

    const res = await fetch(
      `http://localhost:${port}/api/sync?file=${encodeURIComponent(realPath)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bigPayload),
      }
    );
    expect(res.status).toBe(413);
  });

  it('rejects graph file exceeding edge limit', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const graphFile = path.join(tmpDir, 'edges.vync');
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        version: 1,
        type: 'graph',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: 'n1',
            type: 'concept',
            position: { x: 0, y: 0 },
            data: { label: 'A' },
          },
          {
            id: 'n2',
            type: 'concept',
            position: { x: 0, y: 0 },
            data: { label: 'B' },
          },
        ],
        edges: [],
      })
    );
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({
      initialFile: graphFile,
      port,
      mode: 'production',
    });
    shutdownFn = result.shutdown;

    const realPath = await fs.realpath(graphFile);

    const bigPayload = {
      version: 1,
      type: 'graph',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'n1',
          type: 'concept',
          position: { x: 0, y: 0 },
          data: { label: 'A' },
        },
        {
          id: 'n2',
          type: 'concept',
          position: { x: 0, y: 0 },
          data: { label: 'B' },
        },
      ],
      edges: Array.from({ length: 5001 }, (_, i) => ({
        id: `e${i}`,
        source: 'n1',
        target: 'n2',
        data: { label: `edge-${i}` },
      })),
    };

    const res = await fetch(
      `http://localhost:${port}/api/sync?file=${encodeURIComponent(realPath)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bigPayload),
      }
    );
    expect(res.status).toBe(413);
  });

  it('canvas file PUT still works alongside graph files', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const graphFile = path.join(tmpDir, 'graph.vync');
    await fs.writeFile(
      graphFile,
      JSON.stringify({
        version: 1,
        type: 'graph',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
      })
    );
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({
      initialFile: graphFile,
      port,
      mode: 'production',
    });
    shutdownFn = result.shutdown;

    // Register a canvas file alongside the graph file
    const canvasFile = path.join(tmpDir, 'canvas.vync');
    await fs.writeFile(
      canvasFile,
      JSON.stringify({
        version: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        elements: [],
      })
    );
    const realCanvas = await fs.realpath(canvasFile);

    await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: realCanvas }),
    });

    const putRes = await fetch(
      `http://localhost:${port}/api/sync?file=${encodeURIComponent(realCanvas)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          elements: [],
        }),
      }
    );
    expect(putRes.status).toBe(200);
  });
});
