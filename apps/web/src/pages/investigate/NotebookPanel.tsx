import { useTranslation } from 'react-i18next';
import { Textarea, cx } from '../../components/ui';
import { useWorkspace } from './session';

export function NotebookStatusText() {
  const { t } = useTranslation();
  const { notebook } = useWorkspace();
  const map = { saved: t('notebook.saved'), dirty: t('notebook.unsaved'), saving: t('notebook.saving'), error: t('notebook.error') };
  return (
    <span className={cx('text-xs', notebook.status === 'error' ? 'text-danger' : 'text-muted')} role="status">
      {map[notebook.status]}
    </span>
  );
}

/** Free-text notebook (debounced autosave via PUT /notes). `compact` is the desktop side panel. */
export function NotebookPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { notebook, readOnly, data } = useWorkspace();
  const clues = data.investigation.clues;
  return (
    <div className={cx('flex flex-col gap-2', compact ? 'h-full' : '')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={cx('font-bold', compact ? 'text-base' : 'text-xl')}>🗒️ {t('notebook.title')}</h2>
        <NotebookStatusText />
      </div>
      {!compact && <p className="text-sm text-muted">{t('notebook.help')}</p>}
      <Textarea
        aria-label={t('notebook.title')}
        placeholder={t('notebook.placeholder')}
        className={cx('paper-plain font-serif leading-relaxed', compact ? 'min-h-0 flex-1 resize-none text-sm' : 'min-h-[50vh]')}
        maxLength={20000}
        value={notebook.text}
        readOnly={readOnly}
        onChange={(e) => notebook.setText(e.target.value)}
      />
      {clues.length > 0 && (
        <details className="rounded-xl border border-line bg-surface p-2 text-sm" open={!compact}>
          <summary className="cursor-pointer font-semibold">
            {t('board.clues')} ({clues.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs" lang="en">
            {clues.map((c) => (
              <li key={c.id} className="rounded-lg bg-surface-2 px-2 py-1">
                “{c.text}”
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
