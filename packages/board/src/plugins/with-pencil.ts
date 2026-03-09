import { isPencilEvent, PlaitBoard } from '@plait/core';
import { BoardState } from '../hooks/use-board';

const IS_PENCIL_MODE = new WeakMap<PlaitBoard, boolean>();

export const isPencilMode = (board: PlaitBoard) => {
  return !!IS_PENCIL_MODE.get(board);
};

export const setIsPencilMode = (board: PlaitBoard, isPencilMode: boolean) => {
  IS_PENCIL_MODE.set(board, isPencilMode);
};

export const buildPencilPlugin = (
  updateAppState: (appState: Partial<BoardState>) => void
) => {
  const withPencil = (board: PlaitBoard) => {
    const { pointerDown } = board;

    board.pointerDown = (event: PointerEvent) => {
      if (isPencilEvent(event) && !isPencilMode(board)) {
        setIsPencilMode(board, true);
        updateAppState({ isPencilMode: true });
      }
      if (isPencilMode(board) && !isPencilEvent(event)) {
        return;
      }
      pointerDown(event);
    };

    return board;
  };
  return withPencil;
};
