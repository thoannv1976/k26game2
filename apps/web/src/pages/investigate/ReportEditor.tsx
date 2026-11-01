import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, isApiError } from '../../api/client';
import type { DraftView, SessionPayload } from '../../api/types';
import { errorMessage, submitBlockers } from '../../i18n/errors';
import { clearBackup, draftReducer, initDraft, readBackup, shouldAutosave, writeBackup, type DraftState, type ServerDraft } from '../../lib/draft';
import { wordCount, wordTarget } from '../../lib/text';
import { Alert, Badge, Button, Card, Modal, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { sessionKey, useWorkspace } from './session';
import { useElapsed } from './useElapsed';

const AUTOSAVE_MS = 10_000;

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Draft state + autosave every 10 s when changed, local backup, conflict handling. */
function useDraft() {
  const { sid, data, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(draftReducer, undefined, () => initDraft(data.draft, readOnly ? null : readBackup(sid)));
  const latest = useRef<DraftState>(state);
  latest.current = state;
  const online = useOnline();

  // Local backup holds only unsaved text (so a later restore never re-opens text that was already saved).
  useEffect(() => {
    if (readOnly) return;
    if (state.text !== state.savedText) writeBackup(sid, state);
    else clearBackup(sid);
  }, [sid, readOnly, state.text, state.savedText, state.version]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves if needed. Resolves with whether the server now has `text`, and the server version. */
  const save = useCallback(async (): Promise<{ ok: boolean; text: string; version: number }> => {
    const s = latest.current;
    if (readOnly || !shouldAutosave(s)) return { ok: s.text === s.savedText && s.status !== 'conflict', text: s.savedText, version: s.version };
    const sent = s.text;
    dispatch({ type: 'saveStart' });
    try {
      const r = await api.put<{ draft: DraftView }>(`/api/sessions/${sid}/draft`, { text: sent, baseVersion: s.version });
      dispatch({ type: 'saveSuccess', draft: r.draft, sentText: sent });
      qc.setQueryData<SessionPayload>(sessionKey(sid), (old) => (old ? { ...old, draft: r.draft } : old));
      return { ok: true, text: sent, version: r.draft.version };
    } catch (e) {
      if (isApiError(e, 'DRAFT_CONFLICT')) {
        const cur = (e.details as { current?: ServerDraft } | undefined)?.current;
        dispatch({ type: 'conflict', server: cur ? { text: cur.text, version: cur.version, updatedAt: cur.updatedAt } : { text: '', version: s.version + 1 } });
      } else dispatch({ type: 'saveFailed', offline: isApiError(e, 'NETWORK') || !navigator.onLine });
      return { ok: false, text: s.savedText, version: s.version };
    }
  }, [sid, readOnly, qc]);

  useEffect(() => {
    if (readOnly) return;
    const id = setInterval(() => void save(), AUTOSAVE_MS);
    const onHide = () => document.visibilityState === 'hidden' && void save();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      void save();
    };
  }, [save, readOnly]);

  useEffect(() => {
    if (online) {
      dispatch({ type: 'online' });
      void save();
    }
  }, [online, save]);

  return { state, dispatch, save, online, latest };
}

export function ReportEditor() {
  const { t } = useTranslation();
  const { sid, data, readOnly, notebook } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { state, dispatch, save, online, latest } = useDraft();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const elapsed = useElapsed(data.session.startedAt);
  const inv = data.investigation;
  const task = inv.writingTask;
  const words = wordCount(state.text);
  const target = wordTarget(words, task.minWords, task.maxWords);
  const blockers = [...inv.submissionBlockers, ...submitBlockers(submitError).filter((b) => !inv.submissionBlockers.includes(b))];

  const insert = (snippet: string) => {
    const el = ref.current;
    const text = state.text;
    const at = el && document.activeElement === el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    dispatch({ type: 'edit', text: `${before}${sep}${snippet}${text.slice(at)}` });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const text = latest.current.text;
      const saved = await save();
      if (latest.current.status === 'conflict') return;
      // Submit exactly what is in the editor; the server stores it as the final report.
      await api.post(`/api/sessions/${sid}/submit`, { text, draftVersion: saved.version });
      clearBackup(sid);
      void qc.invalidateQueries({ queryKey: sessionKey(sid) });
      void qc.invalidateQueries({ queryKey: ['cases'] });
      void qc.invalidateQueries({ queryKey: ['student-progress'] });
      navigate(`/results/${sid}`);
    } catch (e) {
      setSubmitError(e);
      if (!isApiError(e, 'NOT_READY_TO_SUBMIT')) toast.error(errorMessage(t, e));
    } finally {
      setSubmitting(false);
    }
  };

  const statusTone = { idle: 'neutral', dirty: 'warn', saving: 'neutral', saved: 'success', offline: 'warn', error: 'danger', conflict: 'danger' } as const;
  const sectionDone = (s: string) => state.text.toLowerCase().includes(s.toLowerCase());

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold">✍️ {t('report.task')}</h2>
            <Badge tone="primary">{t('report.target', { min: task.minWords, max: task.maxWords })}</Badge>
          </div>
          <p className="font-serif leading-relaxed" lang="en">
            {task.prompt}
          </p>
          <p className="text-sm text-muted" lang="en">
            {t('report.audience', { audience: task.audience })}
          </p>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t('report.sections')}</h3>
            <ul className="flex flex-wrap gap-2">
              {task.sections.map((s) => (
                <li key={s} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', sectionDone(s) ? 'border-success/40 bg-success-soft text-success' : 'border-line text-muted')} lang="en">
                  {sectionDone(s) ? '✓' : '○'} {s}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {!online && <Alert tone="warn">📡 {t('common.offline')} – {t('report.status.offline')}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="report-wordcount"
              data-words={words}
              className={cx(
                'rounded-full px-3 py-1 font-bold tabular-nums',
                target === 'ok' ? 'bg-success-soft text-success' : target === 'long' ? 'bg-danger-soft text-danger' : target === 'short' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted',
              )}
              aria-live="polite"
            >
              {t('report.words', { count: words })} / {task.minWords}–{task.maxWords}
            </span>
            <span className="text-muted">⏱ {elapsed}</span>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <Badge tone={statusTone[state.status]}>{t(`report.status.${state.status}`)}</Badge>
              {state.lastSavedAt && state.status === 'saved' && (
                <span className="hidden text-xs text-muted sm:inline">{t('report.lastSaved', { time: new Date(state.lastSavedAt).toLocaleTimeString() })}</span>
              )}
              <Button size="sm" variant="ghost" onClick={() => void save()} disabled={state.text === state.savedText || state.inFlight !== null}>
                {t('report.saveNow')}
              </Button>
            </div>
          )}
        </div>

        <textarea
          ref={ref}
          data-testid="report-editor"
          aria-label={t('report.editorLabel')}
          placeholder={t('report.placeholder')}
          lang="en"
          spellCheck
          maxLength={12000}
          readOnly={readOnly}
          value={state.text}
          onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
          onBlur={() => void save()}
          className="paper-plain min-h-[55vh] w-full rounded-2xl border border-line p-4 font-serif text-base leading-relaxed text-fg focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none sm:p-6"
        />

        {!readOnly && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button data-testid="report-submit" size="lg" onClick={() => setConfirm(true)} disabled={state.status === 'conflict'}>
              📨 {t('report.submit')}
            </Button>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <Card>
          <h3 className="mb-2 font-bold">📌 {t('report.evidenceRef')}</h3>
          {inv.evidence.length === 0 ? (
            <p className="text-sm text-muted">{t('board.empty')}</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {inv.evidence.map((e) => (
                <li key={e.id} className="rounded-lg border border-line p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold" lang="en">
                      {e.label}
                    </span>
                    {e.category && <Badge>{t(`board.columns.${e.category}`)}</Badge>}
                  </div>
                  <p className="mt-1 text-muted italic" lang="en">
                    “{e.text}”
                  </p>
                  {!readOnly && (
                    <button type="button" className="mt-1 min-h-8 font-semibold text-primary hover:underline" onClick={() => insert(`“${e.text}”`)}>
                      ＋ {t('report.insert')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 font-bold">🗒️ {t('report.notesRef')}</h3>
          {notebook.text.trim() ? (
            <p className="max-h-64 overflow-y-auto font-serif text-sm whitespace-pre-wrap" lang="en">
              {notebook.text}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('report.noNotes')}</p>
          )}
        </Card>
      </aside>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('report.submitTitle')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button data-testid="submit-confirm" onClick={() => void submit()} loading={submitting} disabled={blockers.length > 0 || words === 0}>
              {t('report.submitConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{t('report.submitBody')}</p>
          <p className={cx('font-semibold', target === 'ok' ? 'text-success' : 'text-warn')}>{t('report.wordWarning', { count: words, min: task.minWords, max: task.maxWords })}</p>
          {blockers.length > 0 && (
            <Alert tone="danger">
              <div className="font-semibold">{t('report.blockers')}</div>
              <ul className="mt-1 list-disc pl-5" lang="en">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          )}
          {submitError !== null && !isApiError(submitError, 'NOT_READY_TO_SUBMIT') && <Alert tone="danger">{errorMessage(t, submitError)}</Alert>}
        </div>
      </Modal>

      <Modal open={state.status === 'conflict' && state.conflict !== null} onClose={() => undefined} dismissable={false} title={t('report.conflictTitle')} size="xl">
        {state.conflict && (
          <div className="space-y-4">
            <p className="text-sm">{t('report.conflictBody')}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  ['mine', state.conflict.local, 'keepMine', 'conflict-keep-mine'],
                  ['server', state.conflict.server.text, 'useServer', 'conflict-use-server'],
                ] as const
              ).map(([k, text, action, testId]) => (
                <div key={k} className="flex flex-col gap-2">
                  <h3 className="font-semibold">
                    {t(`report.${k}`)} · <span className="text-muted">{t('report.words', { count: wordCount(text) })}</span>
                  </h3>
                  <pre className="paper-plain max-h-72 min-h-32 overflow-y-auto rounded-xl border border-line p-3 font-serif text-sm whitespace-pre-wrap" lang="en">
                    {text}
                  </pre>
                  <Button
                    data-testid={testId}
                    variant={k === 'mine' ? 'primary' : 'secondary'}
                    onClick={() => {
                      // Keep a copy of the discarded text on the clipboard where possible – text is never lost silently.
                      const other = k === 'mine' ? state.conflict!.server.text : state.conflict!.local;
                      void navigator.clipboard?.writeText(other).catch(() => undefined);
                      dispatch({ type: action });
                    }}
                  >
                    {t(k === 'mine' ? 'report.keepMine' : 'report.useServer')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
