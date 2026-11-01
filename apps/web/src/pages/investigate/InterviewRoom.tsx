import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isApiError } from '../../api/client';
import type { InterviewResponse, InvCharacter } from '../../api/types';
import { errorMessage } from '../../i18n/errors';
import { uuid } from '../../lib/uuid';
import { Avatar } from '../../components/Avatar';
import { Alert, Badge, Button, EmptyState, ProgressBar, Textarea, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useWorkspace } from './session';

interface Pending {
  id: string;
  characterId: string;
  question: string;
  state: 'sending' | 'failed';
  error?: unknown;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      <span className="typing-dot h-2 w-2 rounded-full bg-muted" />
      <span className="typing-dot h-2 w-2 rounded-full bg-muted" />
      <span className="typing-dot h-2 w-2 rounded-full bg-muted" />
    </span>
  );
}

function CharacterCard({ c, active, onPick }: { c: InvCharacter; active: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid={`character-${c.id}`}
      aria-pressed={active}
      onClick={onPick}
      className={cx('flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors', active ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-primary/60')}
    >
      <Avatar avatar={c.avatar} name={c.name} size={52} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{c.name}</span>
        <span className="block truncate text-xs text-muted" lang="en">
          {c.role}
        </span>
        <span className="mt-1 block text-xs text-muted">{t('interviews.used', { used: c.questionsUsed, max: c.questionsMax })}</span>
      </span>
    </button>
  );
}

export function InterviewRoom() {
  const { t } = useTranslation();
  const { sid, data, readOnly, apply, notebook, goTo } = useWorkspace();
  const toast = useToast();
  const inv = data.investigation;
  const [charId, setCharId] = useState<string | null>(inv.characters[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const c = inv.characters.find((x) => x.id === charId) ?? null;
  const messages = data.interviews.filter((m) => m.characterId === charId);
  const docTitle = (id: string) => inv.documents.find((d) => d.id === id)?.title ?? id;
  const sessionFull = data.session.interviewTotal >= data.session.interviewMax;
  const charFull = c ? c.questionsUsed >= c.questionsMax : true;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending, charId]);

  const send = async (p: Pending) => {
    setPending({ ...p, state: 'sending' });
    try {
      const r = await api.post<InterviewResponse>(`/api/sessions/${sid}/interviews`, { clientMessageId: p.id, characterId: p.characterId, question: p.question });
      apply(r);
      setPending(null);
      if (r.quotaWarning) toast.show(t('inv.quotaWarning'), 'warn');
      for (const id of r.message.unlockedDocumentIds ?? []) {
        const title = r.investigation.documents.find((d) => d.id === id)?.title ?? id;
        toast.success(
          <span>
            🔓 {t('inv.docUnlocked', { title })}{' '}
            <button type="button" className="font-bold underline" onClick={() => goTo('documents', id)}>
              {t('inv.openDoc')}
            </button>
          </span>,
        );
      }
    } catch (e) {
      // Network errors and "in progress" keep the same clientMessageId so a retry never asks twice.
      if (isApiError(e, 'NETWORK') || isApiError(e, 'REQUEST_IN_PROGRESS') || isApiError(e, 'INTERNAL')) setPending({ ...p, state: 'failed', error: e });
      else {
        setPending(null);
        setInput(p.question);
        toast.error(errorMessage(t, e));
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!c || q.length < 3 || pending) return;
    setInput('');
    void send({ id: uuid(), characterId: c.id, question: q, state: 'sending' });
  };

  const saveQuote = (name: string, reply: string) => {
    notebook.append(`> ${name}: “${reply}”`);
    toast.success(t('interviews.savedToNotebook'));
  };

  const lastReplyId = messages[messages.length - 1]?.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('interviews.title')}</h2>
          <p className="max-w-2xl text-sm text-muted">{t('interviews.intro')}</p>
        </div>
        <div className="w-full max-w-xs text-sm">
          <div className="mb-1 text-muted">{t('interviews.total', { used: data.session.interviewTotal, max: data.session.interviewMax })}</div>
          <ProgressBar value={data.session.interviewTotal} max={data.session.interviewMax} tone={sessionFull ? 'danger' : 'primary'} label={t('interviews.total', { used: data.session.interviewTotal, max: data.session.interviewMax })} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
          {inv.characters.map((x) => (
            <li key={x.id}>
              <CharacterCard c={x} active={x.id === charId} onPick={() => setCharId(x.id)} />
            </li>
          ))}
        </ul>
        {!c ? (
          <EmptyState icon="🕵️" title={t('interviews.pick')} />
        ) : (
          <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface" aria-label={c.name}>
            <header className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
              <Avatar avatar={c.avatar} name={c.name} size={44} />
              <div className="min-w-0">
                <div className="font-semibold">{c.name}</div>
                <div className="truncate text-xs text-muted" lang="en">
                  {c.role}
                </div>
              </div>
              <Badge className="ml-auto" tone={charFull ? 'danger' : 'neutral'}>
                {t('interviews.used', { used: c.questionsUsed, max: c.questionsMax })}
              </Badge>
            </header>
            <div ref={logRef} className="max-h-[55vh] min-h-64 flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-relevant="additions">
              <div className="flex gap-2">
                <Avatar avatar={c.avatar} name={c.name} size={32} />
                <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-sm italic" lang="en">
                  {c.greeting}
                </p>
              </div>
              {messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-fg" lang="en">
                      <span className="sr-only">{t('interviews.you')}: </span>
                      {m.question}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Avatar avatar={c.avatar} name={c.name} size={32} />
                    <div className="max-w-[85%] space-y-1">
                      <p data-testid={m.id === lastReplyId ? 'interview-reply' : undefined} className="rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-sm" lang="en">
                        <span className="sr-only">{c.name}: </span>
                        {m.reply}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {m.unlockedDocumentIds.map((id) => (
                          <button key={id} type="button" onClick={() => goTo('documents', id)} className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
                            🔓 {t('interviews.unlocked', { title: docTitle(id) })}
                          </button>
                        ))}
                        {!readOnly && (
                          <button type="button" onClick={() => saveQuote(c.name, m.reply)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary-soft">
                            🗒️ {t('interviews.saveToNotebook')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {pending && pending.characterId === c.id && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/80 px-3 py-2 text-sm text-primary-fg" lang="en">
                      {pending.question}
                    </p>
                  </div>
                  {pending.state === 'sending' ? (
                    <div className="flex items-center gap-2 text-sm text-muted" role="status">
                      <Avatar avatar={c.avatar} name={c.name} size={32} />
                      <TypingDots />
                      <span>{t('interviews.typing', { name: c.name })}</span>
                    </div>
                  ) : (
                    <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {t('interviews.failed')} {errorMessage(t, pending.error)}
                      </span>
                      <span className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void send(pending)}>
                          ↻ {t('interviews.retry')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setInput(pending.question);
                            setPending(null);
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </span>
                    </Alert>
                  )}
                </div>
              )}
            </div>
            {!readOnly && (
              <form onSubmit={onSubmit} className="border-t border-line p-3">
                {charFull || sessionFull ? (
                  <p className="text-sm text-muted">{sessionFull ? t('errors.INTERVIEW_LIMIT') : t('interviews.noMore', { name: c.name })}</p>
                ) : (
                  <div className="flex items-end gap-2">
                    <Textarea
                      data-testid="interview-input"
                      aria-label={t('interviews.inputLabel')}
                      className="min-h-11 flex-1 resize-none"
                      rows={2}
                      maxLength={500}
                      lang="en"
                      placeholder={t('interviews.placeholder', { name: c.name })}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          onSubmit(e);
                        }
                      }}
                    />
                    <Button data-testid="interview-send" type="submit" disabled={input.trim().length < 3 || pending !== null} loading={pending?.state === 'sending'}>
                      {t('interviews.send')}
                    </Button>
                  </div>
                )}
              </form>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
