import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { HintStage } from '@ed/shared';
import { api } from '../../api/client';
import type { SessionPayload, StageId } from '../../api/types';
import { useLocalized } from '../../i18n';
import { errorMessage } from '../../i18n/errors';
import { Alert, Button, ButtonLink, ErrorBox, LevelBadge, Modal, PageSkeleton, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { TABS, WorkspaceProvider, sessionKey, useWorkspace, type TabId } from './session';
import { DocumentRoom } from './DocumentRoom';
import { QuestionsPanel } from './QuestionsPanel';
import { InterviewRoom } from './InterviewRoom';
import { CaseBoard } from './CaseBoard';
import { NotebookPanel } from './NotebookPanel';
import { ReportEditor } from './ReportEditor';
import { AssistantDrawer } from './AssistantDrawer';
import { HintDialog } from './HintDialog';
import { useElapsed } from './useElapsed';

const STAGES: StageId[] = ['introduction', 'documents', 'evidence', 'interviews', 'analysis', 'report'];
const HINT_STAGE_FOR: Record<TabId, HintStage> = { documents: 'documents', questions: 'documents', interviews: 'interviews', board: 'analysis', notebook: 'evidence', report: 'report' };
const TAB_ICON: Record<TabId, string> = { documents: '🗄️', questions: '❓', interviews: '💬', board: '📌', notebook: '🗒️', report: '✍️' };

function StageProgress() {
  const { t } = useTranslation();
  const { data } = useWorkspace();
  const p = data.investigation.progress;
  const done = STAGES.filter((s) => p[s]).length;
  return (
    <div>
      <div className="sr-only">
        {t('inv.progress')}: {done}/6
      </div>
      <ol className="grid grid-cols-6 gap-1" aria-label={t('inv.progress')}>
        {STAGES.map((s, i) => (
          <li key={s} className="min-w-0" aria-current={!p[s] && STAGES.slice(0, i).every((x) => p[x]) ? 'step' : undefined}>
            <div className={cx('h-1.5 rounded-full', p[s] ? 'bg-success' : 'bg-surface-2')} />
            <div className={cx('mt-1 truncate text-[11px] font-semibold sm:text-xs', p[s] ? 'text-success' : 'text-muted')} title={t(`inv.stages.${s}`)}>
              {p[s] ? '✓ ' : `${i + 1}. `}
              <span className="hidden sm:inline">{t(`inv.stages.${s}`)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Header({ onHint, onAssistant }: { onHint: () => void; onAssistant: () => void }) {
  const { t } = useTranslation();
  const { L } = useLocalized();
  const { data, readOnly } = useWorkspace();
  const inv = data.investigation;
  const elapsed = useElapsed(data.session.startedAt, data.session.submittedAt);
  const totalMin = data.session.timeMinutes;
  const over = (Date.now() - new Date(data.session.startedAt).getTime()) / 60000 > totalMin && !readOnly;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded-md bg-manila px-2 py-0.5 font-mono text-xs font-bold">{inv.caseId}</span>
        <LevelBadge level={inv.level} />
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg font-bold sm:text-xl">{L(inv.title)}</h1>
        <span className={cx('text-sm tabular-nums', over ? 'font-semibold text-warn' : 'text-muted')} title={t('inv.elapsedHint')}>
          ⏱ {t('inv.elapsed', { elapsed, total: totalMin })}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onHint} data-testid="hint-open">
            💡 {t('inv.hint')}
          </Button>
          <Button size="sm" variant="secondary" onClick={onAssistant} data-testid="assistant-open">
            🧭 {t('inv.assistant')}{' '}
            <span className="text-xs text-muted">
              {inv.assistant.used}/{inv.assistant.max}
            </span>
          </Button>
        </div>
      </div>
      <StageProgress />
    </div>
  );
}

function TabNav({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const { t } = useTranslation();
  const { data } = useWorkspace();
  const inv = data.investigation;
  const badge: Partial<Record<TabId, number>> = {
    documents: inv.documents.filter((d) => !d.locked && !d.opened).length,
    questions: inv.questions.filter((q) => !q.answer).length,
    board: inv.evidence.filter((e) => !e.category).length,
  };
  return (
    <nav
      aria-label={t('inv.tabs.label')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:sticky lg:top-20 lg:bottom-auto lg:z-0 lg:self-start lg:rounded-2xl lg:border lg:bg-surface lg:p-2 lg:pb-2"
    >
      <ul className="grid grid-cols-6 lg:grid-cols-1 lg:gap-1">
        {TABS.map((id) => (
          <li key={id}>
            <button
              type="button"
              data-testid={`tab-${id}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => onTab(id)}
              className={cx(
                'relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold sm:text-xs lg:min-h-11 lg:flex-row lg:justify-start lg:gap-2 lg:rounded-xl lg:px-3 lg:text-sm',
                tab === id ? 'text-primary lg:bg-primary-soft' : 'text-muted hover:text-fg',
              )}
            >
              <span aria-hidden="true" className="text-lg lg:text-base">
                {TAB_ICON[id]}
              </span>
              <span className="max-w-full truncate">{t(`inv.tabs.${id}`)}</span>
              {Boolean(badge[id]) && (
                <span className="absolute top-1 right-1/4 min-w-5 rounded-full bg-string px-1 text-[10px] leading-5 text-white lg:static lg:ml-auto">{badge[id]}</span>
              )}
              {tab === id && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary lg:hidden" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BriefingModal() {
  const { t } = useTranslation();
  const { L } = useLocalized();
  const { sid, data, readOnly, apply } = useWorkspace();
  const toast = useToast();
  const inv = data.investigation;
  const ack = useMutation({
    mutationFn: () => api.post<SessionPayload>(`/api/sessions/${sid}/briefing`),
    onSuccess: apply,
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const open = !inv.briefingAcknowledged && !readOnly;
  return (
    <Modal
      open={open}
      onClose={() => undefined}
      dismissable={false}
      title={`🗂️ ${t('inv.briefingTitle')} · ${inv.caseId}`}
      size="lg"
      footer={
        <Button data-testid="briefing-ack" size="lg" onClick={() => ack.mutate()} loading={ack.isPending}>
          🔎 {t('inv.briefingAck')}
        </Button>
      }
    >
      <div className="space-y-4">
        <h3 className="font-serif text-2xl font-bold">{L(inv.title)}</h3>
        <p className="font-serif text-lg leading-relaxed whitespace-pre-line">{L(inv.briefing)}</p>
        <ol className="list-decimal space-y-1 pl-6">
          {inv.objectives.map((o, i) => (
            <li key={i}>{L(o)}</li>
          ))}
        </ol>
        <Alert tone="primary">{t('inv.briefingHelp')}</Alert>
      </div>
    </Modal>
  );
}

function Workspace({ tab, docId, onTab, onDoc }: { tab: TabId; docId: string | null; onTab: (t: TabId) => void; onDoc: (id: string | null) => void }) {
  const { t } = useTranslation();
  const { data, readOnly } = useWorkspace();
  const [hintOpen, setHintOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const status = data.session.status;
  // Notebook side panel on wide screens, except where the tab needs the full width.
  const sidePanel = tab !== 'notebook' && tab !== 'report' && tab !== 'board';
  return (
    <div className="space-y-4">
      <Header onHint={() => setHintOpen(true)} onAssistant={() => setAssistantOpen(true)} />
      {readOnly && (
        <Alert tone={status === 'abandoned' ? 'neutral' : 'success'} className="flex flex-wrap items-center justify-between gap-2">
          <span>{status === 'abandoned' ? t('results.abandoned') : `📨 ${t('inv.submittedBanner')}`}</span>
          {status !== 'abandoned' && (
            <ButtonLink to={`/results/${data.session.id}`} size="sm">
              {t('inv.viewResults')}
            </ButtonLink>
          )}
        </Alert>
      )}
      <div className={cx('grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)]', sidePanel && 'xl:grid-cols-[190px_minmax(0,1fr)_280px]')}>
        <TabNav tab={tab} onTab={onTab} />
        <div className="min-w-0" role="region" aria-label={t(`inv.tabs.${tab}`)}>
          {tab === 'documents' && <DocumentRoom docId={docId} onPickDoc={onDoc} />}
          {tab === 'questions' && <QuestionsPanel />}
          {tab === 'interviews' && <InterviewRoom />}
          {tab === 'board' && <CaseBoard />}
          {tab === 'notebook' && <NotebookPanel />}
          {tab === 'report' && <ReportEditor />}
        </div>
        {sidePanel && (
          <aside className="hidden xl:block">
            <div className="sticky top-20 h-[calc(100dvh-7rem)] rounded-2xl border border-line bg-surface p-3">
              <NotebookPanel compact />
            </div>
          </aside>
        )}
      </div>
      <BriefingModal />
      <HintDialog open={hintOpen} onClose={() => setHintOpen(false)} initialStage={HINT_STAGE_FOR[tab]} />
      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} stage={HINT_STAGE_FOR[tab]} />
    </div>
  );
}

export default function InvestigatePage() {
  const { sessionId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: sessionKey(sessionId), queryFn: () => api.get<SessionPayload>(`/api/sessions/${sessionId}`) });
  const tabParam = params.get('tab') as TabId | null;
  const tab: TabId = tabParam && TABS.includes(tabParam) ? tabParam : 'documents';
  const docId = params.get('doc');

  const goTo = useCallback(
    (next: TabId, doc?: string | null) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set('tab', next);
          if (doc !== undefined) {
            if (doc) n.set('doc', doc);
            else n.delete('doc');
          }
          return n;
        },
        { replace: false },
      );
      window.scrollTo({ top: 0 });
    },
    [setParams],
  );

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <WorkspaceProvider key={sessionId} sid={sessionId} data={q.data} goTo={(tb, d) => goTo(tb, d)} refetch={() => void q.refetch()}>
      <Workspace tab={tab} docId={docId} onTab={(tb) => goTo(tb)} onDoc={(d) => goTo('documents', d)} />
    </WorkspaceProvider>
  );
}
