import { describe, it, expect } from 'vitest';
import type { WsMessage } from '../types.js';

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
