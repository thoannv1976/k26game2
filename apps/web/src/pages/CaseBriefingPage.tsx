import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { CaseDetailResponse, StartSessionResponse, StudentProgress } from '../api/types';
import { useLocalized } from '../i18n';
import { errorMessage } from '../i18n/errors';
import { Alert, Button, ButtonLink, Card, ConfirmModal, ErrorBox, LevelBadge, PageSkeleton, SectionTitle } from '../components/ui';
import { Avatar } from '../components/Avatar';
import { stripView } from './investigate/session';

export function CaseBriefingPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const { L } = useLocalized();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const q = useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetailResponse>(`/api/cases/${id}`) });
  const progress = useQuery({ queryKey: ['student-progress'], queryFn: () => api.get<StudentProgress>('/api/student/progress') });
  const assignment = progress.data?.assignments.find((a) => a.id === params.get('assignment')) ?? progress.data?.assignments.find((a) => a.caseId === id && !a.solved);

  const start = useMutation({
    mutationFn: (restart: boolean) => api.post<StartSessionResponse>('/api/sessions', { caseId: id, ...(assignment ? { assignmentId: assignment.id } : {}), ...(restart ? { restart: true } : {}) }),
    onSuccess: (r) => {
      qc.setQueryData(['session', r.session.id], stripView(r));
      void qc.invalidateQueries({ queryKey: ['cases'] });
      void qc.invalidateQueries({ queryKey: ['student-progress'] });
      navigate(`/investigate/${r.session.id}`);
    },
  });

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const { case: c, activeSessionId } = q.data;

  return (
    <div className="space-y-6">
      <ButtonLink to="/office" variant="ghost" size="sm" className="-ml-3">
        ← {t('briefing.back')}
      </ButtonLink>
      <div className="relative pt-6">
        <span className="absolute top-0 left-5 rounded-t-lg border border-b-0 border-manila-2 bg-manila px-4 py-1.5 font-mono text-sm font-bold tracking-wider">{t('briefing.caseFile', { id: c.id })}</span>
        <div className="rounded-2xl rounded-tl-none border border-manila-2 bg-manila p-3 sm:p-4">
          <div className="paper-plain space-y-5 rounded-xl p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <LevelBadge level={c.level} />
              <span>⏱ {t('office.minutes', { count: c.estimatedMinutes })}</span>
              <span>★ {t('office.xp', { count: c.xpReward })}</span>
              <span>· {c.setting}</span>
            </div>
            <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">{L(c.title)}</h1>
            <p className="text-sm font-semibold text-string" lang="en">
              {t('briefing.yourRole', { role: c.role })}
            </p>
            <div>
              <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted uppercase">{t('briefing.situation')}</h2>
              <p className="font-serif text-lg leading-relaxed whitespace-pre-line">{L(c.briefing)}</p>
            </div>
            <div>
              <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted uppercase">{t('briefing.objectives')}</h2>
              <ol className="list-decimal space-y-1 pl-6">
                {c.objectives.map((o, i) => (
                  <li key={i}>{L(o)}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <SectionTitle>{t('briefing.people')}</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {c.characters.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <Avatar avatar={p.avatar} name={p.name} size={52} />
                <div className="min-w-0">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm text-muted" lang="en">
                    {p.role}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-4">
          <div>
            <SectionTitle>{t('briefing.task')}</SectionTitle>
            <p className="text-sm">{t('briefing.taskBody', { type: t(`briefing.taskType.${c.writingTask.type}`), min: c.writingTask.minWords, max: c.writingTask.maxWords })}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t('briefing.limits')}</h3>
            <ul className="space-y-1 text-sm text-muted">
              <li>💬 {t('briefing.interviewLimit', { count: c.limits.interviewQuestionsPerCharacter })}</li>
              <li>🧭 {t('briefing.assistantLimit', { count: c.limits.assistantRequests })}</li>
              <li>📌 {t('briefing.minEvidence', { count: c.limits.minEvidenceToSubmit })}</li>
              <li>⏱ {t('briefing.timeLimit', { count: c.limits.timeMinutes })}</li>
            </ul>
          </div>
          {assignment && <Alert tone="primary">📋 {t('briefing.assignment', { course: assignment.courseName })}</Alert>}
          {start.isError && <Alert tone="danger">{errorMessage(t, start.error)}</Alert>}
          <div className="flex flex-col gap-2">
            {activeSessionId ? (
              <>
                {/* With an assignment, resume through the API so the open session is linked to it (LMS grade sync). */}
                <Button
                  data-testid="case-continue"
                  size="lg"
                  loading={start.isPending}
                  onClick={() => (assignment ? start.mutate(false) : navigate(`/investigate/${activeSessionId}`))}
                >
                  ▶ {t('briefing.continue')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmRestart(true)} disabled={start.isPending}>
                  ↺ {t('briefing.startOver')}
                </Button>
              </>
            ) : (
              <Button data-testid="case-start" size="lg" loading={start.isPending} onClick={() => start.mutate(false)}>
                🔎 {t('briefing.start')}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        onConfirm={() => {
          setConfirmRestart(false);
          start.mutate(true);
        }}
        title={t('briefing.startOverTitle')}
        confirmLabel={t('briefing.startOver')}
        confirmTestId="case-restart-confirm"
        tone="danger"
        loading={start.isPending}
      >
        <p>{t('briefing.startOverBody')}</p>
      </ConfirmModal>
    </div>
  );
}
