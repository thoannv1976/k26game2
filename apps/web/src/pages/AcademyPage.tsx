import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ACHIEVEMENTS } from '@engine/scoring';
import { api, qs } from '../api/client';
import type { LeaderboardResponse, StudentProgress } from '../api/types';
import { useLocalized } from '../i18n';
import { formatDate } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBox, Field, LevelBadge, PageHeader, PageSkeleton, ProgressBar, SectionTitle, Select, Skeleton, StatCard, Table, cx } from '../components/ui';

const RANKS = [
  { key: 'rookie', min: 0 },
  { key: 'junior', min: 300 },
  { key: 'senior', min: 900 },
  { key: 'chief', min: 2000 },
] as const;

export function rankFor(xp: number) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k]!.min) i = k;
  const next = RANKS[i + 1];
  return { key: RANKS[i]!.key, from: RANKS[i]!.min, to: next?.min ?? null };
}

function Leaderboard() {
  const { t } = useTranslation();
  const courses = useQuery({ queryKey: ['student-courses'], queryFn: () => api.get<{ courses: { id: string; code: string; name: string }[] }>('/api/student/courses') });
  const [courseId, setCourseId] = useState('');
  useEffect(() => {
    if (!courseId && courses.data?.courses[0]) setCourseId(courses.data.courses[0].id);
  }, [courses.data, courseId]);
  const lb = useQuery({ queryKey: ['leaderboard', courseId], queryFn: () => api.get<LeaderboardResponse>(`/api/leaderboard${qs({ courseId })}`), enabled: Boolean(courseId) });
  return (
    <Card>
      <SectionTitle
        actions={
          courses.data && courses.data.courses.length > 1 ? (
            <Field label={t('academy.course')}>
              {(id) => (
                <Select id={id} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  {courses.data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : undefined
        }
      >
        🏆 {t('academy.leaderboard')}
      </SectionTitle>
      <p className="mb-3 text-xs text-muted">{t('academy.leaderboardNote')}</p>
      {courses.isPending ? (
        <Skeleton className="h-40" />
      ) : courses.isError ? (
        <ErrorBox error={courses.error} onRetry={() => void courses.refetch()} />
      ) : courses.data.courses.length === 0 ? (
        <EmptyState icon="🏫" title={t('academy.noCourses')} />
      ) : lb.isPending ? (
        <Skeleton className="h-40" />
      ) : lb.isError ? (
        <ErrorBox error={lb.error} onRetry={() => void lb.refetch()} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('academy.rankCol')}</th>
              <th>{t('common.name')}</th>
              <th>{t('academy.dp')}</th>
              <th>XP</th>
              <th>{t('academy.solved')}</th>
              <th>{t('academy.badgesCol')}</th>
            </tr>
          </thead>
          <tbody>
            {lb.data.rows.map((r) => (
              <tr key={r.uid} className={cx(r.isMe && 'bg-primary-soft font-semibold')} aria-current={r.isMe ? 'true' : undefined}>
                <td className="tabular-nums">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
                <td>
                  {r.displayName} {r.isMe && <Badge tone="primary">{t('academy.you')}</Badge>}
                </td>
                <td className="tabular-nums">{r.detectivePoints}</td>
                <td className="tabular-nums">{r.xp}</td>
                <td className="tabular-nums">{r.casesSolved}</td>
                <td className="tabular-nums">{r.badges}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export default function AcademyPage() {
  const { t } = useTranslation();
  const { L, lang } = useLocalized();
  const q = useQuery({ queryKey: ['student-progress'], queryFn: () => api.get<StudentProgress>('/api/student/progress') });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const { user, stats, achievements, recent } = q.data;
  const rank = rankFor(stats.xp);
  return (
    <div className="space-y-6">
      <PageHeader title={`🎓 ${t('academy.title')}`} subtitle={t('academy.subtitle')} />
      <Card className="flex flex-wrap items-center gap-5">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-primary text-4xl text-primary-fg" aria-hidden="true">
          🕵️
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-xl font-bold">{user.displayName}</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="warn">⭐ {t(`academy.ranks.${rank.key}`)}</Badge>
            <span className="text-muted">{t('academy.level')}:</span> <LevelBadge level={stats.level} />
          </div>
          {rank.to !== null && (
            <div className="max-w-sm">
              <ProgressBar value={stats.xp - rank.from} max={rank.to - rank.from} tone="warn" label={t('academy.rank')} />
              <div className="mt-1 text-xs text-muted tabular-nums">
                {stats.xp} / {rank.to} XP
              </div>
            </div>
          )}
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label={t('academy.dp')} value={stats.detectivePoints} />
        <StatCard label={t('academy.xp')} value={stats.xp} />
        <StatCard label={t('academy.solved')} value={`${stats.casesSolved}/${stats.casesTotal}`} />
        <StatCard label={t('academy.reports')} value={stats.reports} />
        <StatCard label={t('academy.average')} value={stats.averagePercent === null ? '—' : `${stats.averagePercent}%`} />
      </div>
      <Card>
        <SectionTitle>🎖️ {t('academy.badges')}</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(ACHIEVEMENTS).map(([k, v]) => {
            const earned = achievements.includes(k);
            return (
              <li key={k} className={cx('flex items-center gap-3 rounded-xl border p-3', earned ? 'border-warn/40 bg-warn-soft' : 'border-dashed border-line opacity-70')}>
                <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl', earned ? 'bg-warn text-white' : 'bg-surface-2 grayscale')} aria-hidden="true">
                  {earned ? '🏅' : '🔒'}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{v[lang]}</span>
                  <span className="text-xs text-muted">{earned ? t('academy.earned') : t('academy.locked')}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>📄 {t('academy.recent')}</SectionTitle>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">{t('academy.noRecent')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.sessionId}>
                  <Link to={`/results/${r.sessionId}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-primary">
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {r.caseId} · {L(r.title)}
                      </span>
                      <span className="block text-xs text-muted">{formatDate(r.createdAt, lang, true)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {r.reviewed && <Badge tone="success">✓ {t('academy.reviewed')}</Badge>}
                      <Badge tone={r.solved ? 'success' : 'danger'}>{r.solved ? t('results.closed') : t('results.unsolved')}</Badge>
                      <span className="font-bold tabular-nums">{r.percent}%</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Leaderboard />
      </div>
    </div>
  );
}
