/**
 * A React context for sharing the board object, in a way that re-renders the
 * context whenever changes occur.
 */
import { PlaitBoard, PlaitPointerType } from '@plait/core';
import { createContext, useContext } from 'react';
import { MindPointerType } from '@plait/mind';
import { DrawPointerType } from '@plait/draw';
import { FreehandShape } from '../plugins/freehand/type';
import { Editor } from 'slate';
import { LinkElement } from '@plait/common';

export enum DialogType {
  mermaidImport = 'mermaidImport',
  markdownImport = 'markdownImport',
}

export type BoardPointerType =
  | PlaitPointerType
  | MindPointerType
  | DrawPointerType
  | FreehandShape;

export interface BoardWithState extends PlaitBoard {
  appState: BoardState;
}

export type LinkState = {
  targetDom: HTMLElement;
  editor: Editor;
  targetElement: LinkElement;
  isEditing: boolean;
  isHovering: boolean;
  isHoveringOrigin: boolean;
};

export type BoardState = {
  pointer: BoardPointerType;
  isMobile: boolean;
  isPencilMode: boolean;
  openDialogType: DialogType | null;
  openCleanConfirm: boolean;
  linkState?: LinkState | null;
};

export const BoardContext = createContext<{
  appState: BoardState;
  setAppState: (appState: BoardState) => void;
} | null>(null);

export const useBoardContext = (): {
  appState: BoardState;
  setAppState: (appState: BoardState) => void;
} => {
  const context = useContext(BoardContext);

  if (!context) {
    throw new Error(
      `The \`useBoardContext\` hook must be used inside the <VyncBoard> component's context.`
    );
  }

  return context;
};

export const useSetPointer = () => {
  const { appState, setAppState } = useBoardContext();
  return (pointer: BoardPointerType) => {
    setAppState({ ...appState, pointer });
  };
};
