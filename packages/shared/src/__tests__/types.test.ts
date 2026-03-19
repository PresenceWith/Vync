import { describe, it, expect } from 'vitest';
import type {
  VyncFile,
  VyncCanvasFile,
  VyncGraphFile,
  GraphNode,
  GraphEdge,
  WsMessage,
} from '../types.js';
import { isGraphFile, isCanvasFile } from '../types.js';

describe('WsMessage', () => {
  it('should accept filePath field', () => {
    const msg: WsMessage = {
      type: 'file-changed',
      filePath: '/path/to/file.vync',
      data: { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] },
    };
    expect(msg.filePath).toBe('/path/to/file.vync');
  });

  it('should accept new message types', () => {
    const closed: WsMessage = { type: 'file-closed', filePath: '/a.vync' };
    const deleted: WsMessage = { type: 'file-deleted', filePath: '/a.vync' };
    const error: WsMessage = { type: 'error', code: 'FILE_NOT_FOUND' };
    expect(closed.type).toBe('file-closed');
    expect(deleted.type).toBe('file-deleted');
    expect(error.code).toBe('FILE_NOT_FOUND');
  });
});

describe('VyncFile discriminated union', () => {
  it('isGraphFile returns true for graph files', () => {
    const graph: VyncGraphFile = {
      version: 1,
      type: 'graph',
      viewport: { zoom: 1, x: 0, y: 0 },
      nodes: [],
      edges: [],
    };
    expect(isGraphFile(graph)).toBe(true);
    expect(isCanvasFile(graph)).toBe(false);
  });

  it('isGraphFile returns false for canvas files', () => {
    const canvas: VyncCanvasFile = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [],
    };
    expect(isGraphFile(canvas)).toBe(false);
    expect(isCanvasFile(canvas)).toBe(true);
  });

  it('isGraphFile returns false when type is undefined (legacy canvas)', () => {
    const legacy = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [],
    } as VyncFile;
    expect(isGraphFile(legacy)).toBe(false);
    expect(isCanvasFile(legacy)).toBe(true);
  });

  it('isGraphFile handles malformed input gracefully', () => {
    expect(isGraphFile({} as VyncFile)).toBe(false);
    expect(isCanvasFile({} as VyncFile)).toBe(true); // default fallback
  });

  it('GraphNode has required fields', () => {
    const node: GraphNode = {
      id: 'abc12',
      type: 'concept',
      position: { x: 0, y: 0 },
      data: { label: 'Test', category: 'class' },
    };
    expect(node.id).toBe('abc12');
    expect(node.data.label).toBe('Test');
  });

  it('GraphEdge has required fields', () => {
    const edge: GraphEdge = {
      id: 'e1f2g',
      source: 'abc12',
      target: 'h3i4j',
      data: { label: 'is-a', type: 'inheritance' },
    };
    expect(edge.source).toBe('abc12');
  });

  it('WsMessage accepts VyncGraphFile as data', () => {
    const msg: WsMessage = {
      type: 'file-changed',
      data: {
        version: 1,
        type: 'graph',
        viewport: { zoom: 1, x: 0, y: 0 },
        nodes: [],
        edges: [],
      },
    };
    expect(msg.type).toBe('file-changed');
  });
});
