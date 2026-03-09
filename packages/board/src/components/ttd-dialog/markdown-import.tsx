import { useState, useEffect, useDeferredValue } from 'react';
import './mermaid-import.scss';
import './ttd-dialog.scss';
import { TTDDialogPanels } from './ttd-dialog-panels';
import { TTDDialogPanel } from './ttd-dialog-panel';
import { TTDDialogInput } from './ttd-dialog-input';
import { TTDDialogOutput } from './ttd-dialog-output';
import { TTDDialogSubmitShortcut } from './ttd-dialog-submit-shortcut';
import { useBoardContext } from '../../hooks/use-board';
import { useI18n } from '../../i18n';
import { useBoard } from '@plait-board/react-board';
import {
  getViewportOrigination,
  PlaitBoard,
  PlaitElement,
  WritableClipboardOperationType,
} from '@plait/core';
import { MindElement } from '@plait/mind';

export interface MarkdownImportProps {
  loaded: boolean;
  api: Promise<{
    parseMarkdownToDrawnix: (
      definition: string,
      mainTopic?: string
    ) => MindElement;
  }>;
}

const MarkdownImport = () => {
  const { appState, setAppState } = useBoardContext();
  const { t, language } = useI18n();
  const [markdownImportLib, setMarkdownImportLib] =
    useState<MarkdownImportProps>({
      loaded: false,
      api: Promise.resolve({
        parseMarkdownToDrawnix: (definition: string, mainTopic?: string) =>
          null as any as MindElement,
      }),
    });

  useEffect(() => {
    const loadLib = async () => {
      try {
        const module = await import('@plait-board/markdown-to-drawnix');
        setMarkdownImportLib({
          loaded: true,
          api: Promise.resolve(module),
        });
      } catch (err) {
        console.error('Failed to load mermaid library:', err);
        setError(new Error(t('dialog.error.loadMermaid')));
      }
    };
    loadLib();
  }, []);
  const [text, setText] = useState(() => t('markdown.example'));
  const [value, setValue] = useState<PlaitElement[]>(() => []);
  const deferredText = useDeferredValue(text.trim());
  const [error, setError] = useState<Error | null>(null);
  const board = useBoard();
   
  // Update markdown example when language changes
  useEffect(() => {
    setText(t('markdown.example'));
  }, [language]);

  useEffect(() => {
    const convertMarkdown = async () => {
      try {
        const api = await markdownImportLib.api;
        let ret;
        try {
          ret = await api.parseMarkdownToDrawnix(deferredText);
        } catch (err: any) {
          ret = await api.parseMarkdownToDrawnix(
            deferredText.replace(/"/g, "'")
          );
        }
        const mind = ret;
        mind.points = [[0, 0]];
        if (mind) {
          setValue([mind]);
          setError(null);
        }
      } catch (err: any) {
        setError(err);
      }
    };
    convertMarkdown();
  }, [deferredText, markdownImportLib]);

  const insertToBoard = () => {
    if (!value.length) {
      return;
    }
    const boardContainerRect =
      PlaitBoard.getBoardContainer(board).getBoundingClientRect();
    const focusPoint = [
      boardContainerRect.width / 4,
      boardContainerRect.height / 2 - 20,
    ];
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigination(board);
    const focusX = origination![0] + focusPoint[0] / zoom;
    const focusY = origination![1] + focusPoint[1] / zoom;
    const elements = value;
    board.insertFragment(
      {
        elements: JSON.parse(JSON.stringify(elements)),
      },
      [focusX, focusY],
      WritableClipboardOperationType.paste
    );
    setAppState({ ...appState, openDialogType: null });
  };

  return (
    <>
      <div className="ttd-dialog-desc">
        {t('dialog.markdown.description')}
      </div>
      <TTDDialogPanels>
        <TTDDialogPanel label={t('dialog.markdown.syntax')}>
          <TTDDialogInput
            input={text}
            placeholder={t('dialog.markdown.placeholder')}
            onChange={(event) => setText(event.target.value)}
            onKeyboardSubmit={() => {
              insertToBoard();
            }}
          />
        </TTDDialogPanel>
        <TTDDialogPanel
          label={t('dialog.markdown.preview')}
          panelAction={{
            action: () => {
              insertToBoard();
            },
            label: t('dialog.markdown.insert'),
          }}
          renderSubmitShortcut={() => <TTDDialogSubmitShortcut />}
        >
          <TTDDialogOutput
            value={value}
            loaded={markdownImportLib.loaded}
            error={error}
          />
        </TTDDialogPanel>
      </TTDDialogPanels>
    </>
  );
};
export default MarkdownImport;
