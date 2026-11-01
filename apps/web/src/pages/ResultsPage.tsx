import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ACHIEVEMENTS } from '@engine/scoring';
import { api } from '../api/client';
import type { GradedResults, ResultsResponse, SessionPayload } from '../api/types';
import { useLocalized } from '../i18n';
import { formatDate } from '../lib/format';
import { Alert, Badge, Button, ButtonLink, Card, ErrorBox, LevelBadge, PageSkeleton, SectionTitle } from '../components/ui';
import { CriteriaBars, EvidenceCard, FeedbackCard, SolutionCard, WritingParts } from '../components/results';
import { sessionKey } from './investigate/session';

const POLL_MS = 3000;
const POLL_MAX_MS = 120_000;

function Reviewing({ timedOut, onRetry }: { timedOut: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-12 text-center" role="status" aria-live="polite">
      <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
        <rect x="22" y="18" width="70" height="88" rx="6" fill="var(--ed-paper)" stroke="var(--ed-line)" strokeWidth="2" />
        <path d="M34 38h46M34 50h40M34 62h44M34 74h30" stroke="var(--ed-muted)" strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" />
        <g className="magnifier-sweep">
          <circle cx="78" cy="60" r="16" fill="rgb(169 193 227 / 0.35)" stroke="var(--ed-primary)" strokeWidth="5" />
          <path d="M90 72l12 12" stroke="var(--ed-primary)" strokeWidth="7" strokeLinecap="round" />
        </g>
      </svg>
      <h1 data-testid="results-status" data-status="grading" className="font-serif text-2xl font-bold">
        {t('results.reviewing')}
      </h1>
      {timedOut ? (
        <>
          <p className="text-muted">{t('results.checkLater')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onRetry}>{t('results.checkAgain')}</Button>
            <ButtonLink to="/office" variant="secondary">
              {t('results.backToOffice')}
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted">{t('results.reviewingBody')}</p>
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-surface-2">
            <div className="indeterminate h-full w-1/3 rounded-full bg-primary" />
          </div>
        </>
      )}
    </div>
  );
}

function Graded({ r, options }: { r: GradedResults; options: Record<string, string[] | undefined> }) {
  const { t } = useTranslation();
  const { L, lang } = useLocalized();
  const a = r.assessment;
  const review = a.teacherReview;
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-manila-2 bg-manila p-3 sm:p-4">
        <div className="paper-plain relative flex flex-wrap items-center gap-6 rounded-xl p-5 sm:p-7">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="font-mono font-bold">{r.case.id}</span>
              <LevelBadge level={r.case.level} />
              <span>{formatDate(r.report.submittedAt, lang, true)}</span>
            </div>
            <h1 className="font-serif text-2xl font-bold sm:text-3xl">{L(r.case.title)}</h1>
            <div data-testid="results-status" data-status="graded" data-solved={a.solved ? 'true' : 'false'}>
              <span className={`stamp stamp-in text-xl sm:text-2xl ${a.solved ? 'text-success' : 'text-danger'}`}>{a.solved ? t('results.closed') : t('results.unsolved')}</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs font-semibold tracking-wide text-muted uppercase">{t('results.score')}</div>
            <div data-testid="results-percent" className="font-serif text-5xl font-bold tabular-nums">
              {a.finalPercent}%
            </div>
            {review && a.percent !== a.finalPercent && <div className="text-xs text-muted">{t('results.aiPercent', { percent: a.percent })}</div>}
            {review && (
              <Badge tone="success" className="mt-2">
                ✓ {review.status === 'adjusted' ? t('results.teacherAdjusted') : t('results.teacherConfirmed')}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card className="space-y-5">
            <SectionTitle>📊 {t('results.criteria')}</SectionTitle>
            <CriteriaBars a={a} />
            <WritingParts a={a} />
            {a.aiStatus !== 'ok' && <Alert>{t('results.noFeedback')}</Alert>}
          </Card>
          {review && (
            <Card className="space-y-2 border-success/40">
              <SectionTitle>👩‍🏫 {t('results.teacherReview')}</SectionTitle>
              <p className="text-xs text-muted">{t('results.reviewedBy', { name: review.reviewerName, date: formatDate(review.reviewedAt, lang, true) })}</p>
              {review.comment && <p className="whitespace-pre-wrap">{review.comment}</p>}
            </Card>
          )}
          <FeedbackCard a={a} />
          <EvidenceCard a={a} />
          <SolutionCard r={r} options={options} />
          <Card>
            <SectionTitle>📄 {t('results.yourReport', { count: r.report.wordCount })}</SectionTitle>
            <div className="paper-plain rounded-xl border border-line p-4 font-serif leading-relaxed whitespace-pre-wrap" lang="en">
              {r.report.text}
            </div>
          </Card>
        </div>
        <aside className="space-y-4">
          <Card className="space-y-2">
            <SectionTitle>🏅 {t('results.gamePoints')}</SectionTitle>
            <p className="text-lg font-bold">{t('results.dp', { count: a.gamePoints.detectivePoints })}</p>
            <p className="text-lg font-bold">{t('results.xp', { count: a.gamePoints.xp })}</p>
            <p className="text-sm text-muted">{t('results.hintsUsed', { count: a.gamePoints.hintsUsed })}</p>
          </Card>
          {a.newAchievements.length > 0 && (
            <Card>
              <SectionTitle>🎖️ {t('results.newAchievements')}</SectionTitle>
              <ul className="space-y-2">
                {a.newAchievements.map((k) => (
                  <li key={k} className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 font-semibold text-warn">
                    🏅 {ACHIEVEMENTS[k]?.[lang] ?? k}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="space-y-3">
            <SectionTitle>➡️ {t('results.next')}</SectionTitle>
            <p className="text-sm" lang="en">
              {a.recommendation.reason}
            </p>
            <div className="flex flex-col gap-2">
              {a.recommendation.nextCaseId && a.recommendation.nextCaseId !== r.case.id && (
                <ButtonLink to={`/cases/${a.recommendation.nextCaseId}`}>{t('results.openCase', { id: a.recommendation.nextCaseId })}</ButtonLink>
              )}
              <ButtonLink to={`/cases/${r.case.id}`} variant="secondary">
                ↺ {t('results.replay')}
              </ButtonLink>
              <ButtonLink to="/office" variant="ghost">
                {t('results.backToOffice')}
              </ButtonLink>
            </div>
          </Card>
          <p className="text-xs text-muted">{t('results.disclaimer')}</p>
        </aside>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const { sessionId = '' } = useParams();
  const { t } = useTranslation();
  const started = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);
  const q = useQuery({
    queryKey: ['results', sessionId],
    queryFn: () => api.get<ResultsResponse>(`/api/sessions/${sessionId}/results`),
    // Grading is asynchronous: poll every 3 s while the report is being reviewed (max ~2 min).
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return (s === 'submitted' || s === 'grading') && !timedOut ? POLL_MS : false;
    },
  });
  const polling = q.data?.status === 'submitted' || q.data?.status === 'grading';
  useEffect(() => {
    if (!polling || timedOut) return;
    const id = setTimeout(() => setTimedOut(true), Math.max(0, POLL_MAX_MS - (Date.now() - started.current)));
    return () => clearTimeout(id);
  }, [polling, timedOut]);
  const session = useQuery({ queryKey: sessionKey(sessionId), queryFn: () => api.get<SessionPayload>(`/api/sessions/${sessionId}`), enabled: q.data?.status === 'graded' });
  const options = Object.fromEntries((session.data?.investigation.questions ?? []).map((x) => [x.id, x.options]));

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (r.status === 'graded') return <Graded r={r} options={options} />;
  if (r.status === 'active' || r.status === 'abandoned') {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <h1 data-testid="results-status" data-status={r.status} className="font-serif text-2xl font-bold">
          {r.status === 'active' ? t('results.notSubmitted') : t('results.abandoned')}
        </h1>
        <div className="flex justify-center gap-2">
          {r.status === 'active' && <ButtonLink to={`/investigate/${sessionId}`}>{t('results.backToCase')}</ButtonLink>}
          <ButtonLink to="/office" variant="secondary">
            {t('results.backToOffice')}
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <Reviewing
      timedOut={timedOut}
      onRetry={() => {
        started.current = Date.now();
        setTimedOut(false);
        void q.refetch();
      }}
    />
  );
}
