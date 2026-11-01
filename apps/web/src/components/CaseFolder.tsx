import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CaseListItem } from '../api/types';
import { useLocalized } from '../i18n';
import { LevelBadge, cx } from './ui';

/** A case as a manila case-file folder. */
export function CaseFolder({ c }: { c: CaseListItem }) {
  const { t } = useTranslation();
  const { L } = useLocalized();
  return (
    <Link
      to={`/cases/${c.id}`}
      data-testid={`case-card-${c.id}`}
      className="group relative block pt-5 transition-transform hover:-translate-y-1 focus-visible:-translate-y-1"
      aria-label={`${c.id} – ${L(c.title)}`}
    >
      {/* folder tab */}
      <span className="absolute top-0 left-4 rounded-t-lg border border-b-0 border-manila-2 bg-manila px-3 py-1 font-mono text-xs font-bold tracking-wider text-fg">{c.id}</span>
      <div className="relative h-full overflow-hidden rounded-2xl rounded-tl-none border border-manila-2 bg-manila p-3 shadow-sm group-hover:shadow-md">
        <div className="paper-plain relative flex h-full flex-col gap-2 rounded-lg p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <LevelBadge level={c.level} />
            <span>⏱ {t('office.minutes', { count: c.estimatedMinutes })}</span>
            <span>★ {t('office.xp', { count: c.xpReward })}</span>
          </div>
          <h3 className="font-serif text-lg leading-snug font-bold">{L(c.title)}</h3>
          <p className="line-clamp-3 text-sm text-muted">{L(c.summary)}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-muted">
            <span>📄 {t('office.docs', { count: c.documentCount })}</span>
            <span>👤 {t('office.witnesses', { count: c.characterCount })}</span>
            {c.bestPercent !== null && <span className="font-semibold text-fg">{t('office.best', { percent: c.bestPercent })}</span>}
          </div>
          {c.activeSessionId && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-fg">▶ {t('office.continue')}</span>
          )}
          {c.solved && (
            <span className={cx('stamp absolute top-3 right-3 bg-paper text-xs text-success')} aria-label={t('office.solved')}>
              {t('office.solved')}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
