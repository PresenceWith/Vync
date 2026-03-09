import MenuItem from '../../menu/menu-item';
import { MarkdownLogoIcon, MermaidLogoIcon } from '../../icons';
import { DialogType, useBoardContext } from '../../../hooks/use-board';
import { useI18n } from '../../../i18n';

export const MermaidImportItem = () => {
  const { appState, setAppState } = useBoardContext();
  const { t } = useI18n();
  return (
    <MenuItem
      data-testid="mermaid-import-button"
      onSelect={() => {
        setAppState({
          ...appState,
          openDialogType: DialogType.mermaidImport,
        });
      }}
      icon={MermaidLogoIcon}
      aria-label={t('extraTools.mermaidImport')}
    >
      {t('extraTools.mermaidImport')}
    </MenuItem>
  );
};

MermaidImportItem.displayName = 'MermaidImport';

export const MarkdownImportItem = () => {
  const { appState, setAppState } = useBoardContext();
  const { t } = useI18n();
  return (
    <MenuItem
      data-testid="markdown-import-button"
      onSelect={() => {
        setAppState({
          ...appState,
          openDialogType: DialogType.markdownImport,
        });
      }}
      icon={MarkdownLogoIcon}
      aria-label={t('extraTools.markdownImport')}
    >
      {t('extraTools.markdownImport')}
    </MenuItem>
  );
};

MarkdownImportItem.displayName = 'MarkdownImport';
