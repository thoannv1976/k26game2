import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Level } from '@ed/shared';
import { api, qs } from '../api/client';
import type { CaseListItem, StudentProgress } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useLocalized } from '../i18n';
import { formatDate } from '../lib/format';
import { Badge, ButtonLink, Card, EmptyState, ErrorBox, PageHeader, SectionTitle, Skeleton, StatCard, cx } from '../components/ui';
import { CaseFolder } from '../components/CaseFolder';
import { OfficeScene, type OfficeSpot } from '../components/OfficeScene';
import { useToast } from '../components/Toast';

const TAB_FOR: Partial<Record<OfficeSpot, string>> = { documents: 'documents', interviews: 'interviews', report: 'report' };

export function OfficePage() {
  const { t } = useTranslation();
  const { L, lang } = useLocalized();
  const { me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [level, setLevel] = useState<Level | ''>('');
  const cases = useQuery({ queryKey: ['cases', level], queryFn: () => api.get<{ cases: CaseListItem[] }>(`/api/cases${qs({ level })}`) });
  const progress = useQuery({ queryKey: ['student-progress'], queryFn: () => api.get<StudentProgress>('/api/student/progress') });

  const active = progress.data?.activeSessions.find((s) => s.status === 'active') ?? null;
  const scrollToCases = () => document.getElementById('case-files')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const onSpot = (spot: OfficeSpot) => {
    if (spot === 'academy') return navigate('/academy');
    if (spot === 'board') return scrollToCases();
    if (active) return navigate(`/investigate/${active.id}?tab=${TAB_FOR[spot]}`);
    toast.show(t('office.needCase'));
    scrollToCases();
  };

  const name = me?.user?.displayName?.split(' ').slice(-1)[0] ?? '';
  const stats = progress.data?.stats;
  const now = Date.now();

  return (
    <div data-testid="office" className="space-y-6">
      <PageHeader title={t('office.hello', { name })} subtitle={t('office.subtitle')} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <OfficeScene onSelect={onSpot} />
          </div>
          {/* Accessible / mobile alternative to the scene hotspots */}
          <nav aria-label={t('office.sceneLabel')} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(['board', 'documents', 'interviews', 'report', 'academy'] as OfficeSpot[]).map((s) => (
              <button key={s} type="button" onClick={() => onSpot(s)} className="min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-left text-xs font-semibold hover:border-primary">
                {t(`office.hotspots.${s}`)}
              </button>
            ))}
          </nav>
          {active && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary-soft px-4 py-3">
              <span className="font-semibold">🔎 {t('office.activeCase', { title: L(active.title) })}</span>
              <ButtonLink to={`/investigate/${active.id}`} size="sm">
                ▶ {t('office.continue')}
              </ButtonLink>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label={t('office.stats.dp')} value={stats?.detectivePoints ?? '—'} />
            <StatCard label={t('office.stats.xp')} value={stats?.xp ?? '—'} />
            <StatCard label={t('office.stats.solved')} value={stats ? `${stats.casesSolved}/${stats.casesTotal}` : '—'} />
            <StatCard label={t('office.stats.average')} value={stats?.averagePercent != null ? `${stats.averagePercent}%` : '—'} />
          </div>
          <Card>
            <SectionTitle>{t('office.assignments')}</SectionTitle>
            {progress.isPending ? (
              <Skeleton className="h-20" />
            ) : progress.isError ? (
              <ErrorBox error={progress.error} onRetry={() => void progress.refetch()} />
            ) : progress.data.assignments.length === 0 ? (
              <p className="text-sm text-muted">{t('office.noAssignments')}</p>
            ) : (
              <ul className="space-y-2">
                {progress.data.assignments
                  .slice()
                  .sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'))
                  .map((a) => {
                    const overdue = !a.solved && a.dueAt && new Date(a.dueAt).getTime() < now;
                    return (
                      <li key={a.id}>
                        <Link to={`/cases/${a.caseId}?assignment=${a.id}`} className="block rounded-xl border border-line p-3 text-sm hover:border-primary">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{a.caseId}</span>
                            {a.solved ? <Badge tone="success">✓ {t('office.done')}</Badge> : overdue ? <Badge tone="danger">{t('office.overdue')}</Badge> : <Badge tone="warn">{t('office.todo')}</Badge>}
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            {a.courseName} · {a.dueAt ? t('office.due', { date: formatDate(a.dueAt, lang, true) }) : t('office.noDue')}
                          </div>
                          {a.note && <div className="mt-1 text-xs">{a.note}</div>}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Card>
          <Card>
            <SectionTitle>{t('office.recommendation')}</SectionTitle>
            {progress.data?.recommendation ? (
              <div className="space-y-2 text-sm">
                <p lang="en">{progress.data.recommendation.reason}</p>
                {progress.data.recommendation.nextCaseId ? (
                  <ButtonLink to={`/cases/${progress.data.recommendation.nextCaseId}`} size="sm" variant="secondary">
                    {progress.data.recommendation.nextCaseId} · {L(progress.data.recommendation.title)}
                  </ButtonLink>
                ) : (
                  <p className="text-muted">{t('office.allDone')}</p>
                )}
                {progress.data.recommendation.tips.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-muted" lang="en">
                    {progress.data.recommendation.tips.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('office.noRecommendation')}</p>
            )}
          </Card>
        </aside>
      </div>

      <section id="case-files" className="scroll-mt-20">
        <SectionTitle
          actions={
            <div className="flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label={t('office.filter')}>
              {(['', 'B1', 'B2'] as const).map((l) => (
                <button
                  key={l || 'all'}
                  type="button"
                  aria-pressed={level === l}
                  onClick={() => setLevel(l)}
                  className={cx('min-h-10 min-w-12 rounded-lg px-3 text-sm font-semibold', level === l ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg')}
                >
                  {l || t('common.all')}
                </button>
              ))}
            </div>
          }
        >
          {t('office.cases')}
        </SectionTitle>
        {cases.isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        ) : cases.isError ? (
          <ErrorBox error={cases.error} onRetry={() => void cases.refetch()} />
        ) : cases.data.cases.length === 0 ? (
          <EmptyState icon="🗂️" title={t('office.noCases')}>
            {t('office.noCasesBody')}
          </EmptyState>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cases.data.cases.map((c) => (
              <li key={c.id}>
                <CaseFolder c={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
