import { Dialog, DialogContent } from '../dialog/dialog';
import MermaidImport from './mermaid-import';
import { DialogType, useBoardContext } from '../../hooks/use-board';
import MarkdownImport from './markdown-import';

export const TTDDialog = ({ container }: { container: HTMLElement | null }) => {
  const { appState, setAppState } = useBoardContext();
  return (
    <>
      <Dialog
        open={appState.openDialogType === DialogType.mermaidImport}
        onOpenChange={(open) => {
          setAppState({
            ...appState,
            openDialogType: open ? DialogType.mermaidImport : null,
          });
        }}
      >
        <DialogContent className="Dialog ttd-dialog" container={container}>
          <MermaidImport></MermaidImport>
        </DialogContent>
      </Dialog>
      <Dialog
        open={appState.openDialogType === DialogType.markdownImport}
        onOpenChange={(open) => {
          setAppState({
            ...appState,
            openDialogType: open ? DialogType.markdownImport : null,
          });
        }}
      >
        <DialogContent className="Dialog ttd-dialog" container={container}>
          <MarkdownImport></MarkdownImport>
        </DialogContent>
      </Dialog>
    </>
  );
};
