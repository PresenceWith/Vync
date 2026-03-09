import { PlaitBoard, PlaitElement } from '@plait/core';
import { MIME_TYPES, VERSIONS } from '../constants';
import { fileOpen, fileSave } from './filesystem';
import { VyncExportedData, VyncExportedType } from './types';
import { loadFromBlob, normalizeFile } from './blob';

export const getDefaultName = () => {
  const time = new Date().getTime();
  return time.toString();
};

export const saveAsJSON = async (
  board: PlaitBoard,
  name: string = getDefaultName()
) => {
  const serialized = serializeAsJSON(board);
  const blob = new Blob([serialized], {
    type: MIME_TYPES.vync,
  });

  const fileHandle = await fileSave(blob, {
    name,
    extension: 'vync',
    description: 'Vync file',
  });
  return { fileHandle };
};

export const loadFromJSON = async (board: PlaitBoard) => {
  const file = await fileOpen({
    description: 'Vync files',
    // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
    // gets resolved. Else, iOS users cannot open `.vync` files.
    // extensions: ["json", "vync", "png", "svg"],
  });
  return loadFromBlob(board, await normalizeFile(file));
};

export const isValidVyncData = (data?: any): data is VyncExportedData => {
  return (
    data &&
    data.type === VyncExportedType.vync &&
    Array.isArray(data.elements) &&
    typeof data.viewport === 'object'
  );
};

export const serializeAsJSON = (board: PlaitBoard): string => {
  const data = {
    type: VyncExportedType.vync,
    version: VERSIONS.vync,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
    theme: board.theme,
  };

  return JSON.stringify(data, null, 2);
};
