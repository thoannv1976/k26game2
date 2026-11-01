import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, isApiError } from '../../api/client';
import type { AssistantResponse, SessionPayload } from '../../api/types';
import { errorMessage } from '../../i18n/errors';
import { uuid } from '../../lib/uuid';
import { Alert, Badge, Button, Modal, ProgressBar, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { sessionKey, useWorkspace } from './session';

export function AssistantDrawer({ open, onClose, stage }: { open: boolean; onClose: () => void; stage: string }) {
  const { t } = useTranslation();
  const { sid, data, readOnly, refetch } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ id: string; question: string; failed?: unknown } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const { used, max } = data.investigation.assistant;
  const full = used >= max;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [data.assistant.length, pending, open]);

  const send = async (p: { id: string; question: string }) => {
    setPending(p);
    try {
      const r = await api.post<AssistantResponse>(`/api/sessions/${sid}/assistant`, { clientMessageId: p.id, stage, question: p.question });
      qc.setQueryData<SessionPayload>(sessionKey(sid), (old) =>
        old && !old.assistant.some((m) => m.id === r.message.id)
          ? {
              ...old,
              assistant: [...old.assistant, r.message],
              investigation: { ...old.investigation, assistant: { ...old.investigation.assistant, used: old.investigation.assistant.used + (r.message.kind === 'unavailable' ? 0 : 1) } },
            }
          : old,
      );
      setPending(null);
      if (r.quotaWarning) toast.show(t('inv.quotaWarning'), 'warn');
      refetch();
    } catch (e) {
      if (isApiError(e, 'NETWORK') || isApiError(e, 'REQUEST_IN_PROGRESS')) setPending({ ...p, failed: e });
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
    if (q.length < 3 || pending) return;
    setInput('');
    void send({ id: uuid(), question: q });
  };

  return (
    <Modal open={open} onClose={onClose} side title={`🧭 ${t('assistant.title')}`}>
      <div className="flex h-full flex-col gap-3">
        <Alert tone="primary">{t('assistant.intro')}</Alert>
        <div className="text-sm">
          <div className="mb-1 text-muted">{t('assistant.remaining', { used, max })}</div>
          <ProgressBar value={used} max={max} tone={full ? 'danger' : 'primary'} label={t('assistant.remaining', { used, max })} />
        </div>
        <div ref={logRef} className="min-h-40 flex-1 space-y-3 overflow-y-auto" role="log" aria-live="polite">
          {data.assistant.length === 0 && !pending && <p className="text-sm text-muted">{t('assistant.empty')}</p>}
          {data.assistant.map((m) => (
            <div key={m.id} className="space-y-1.5">
              <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-fg" lang="en">
                {m.question}
              </p>
              <div className="max-w-[95%] rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-sm" lang="en">
                <Badge className="mb-1">{t(`assistant.kinds.${m.kind}` as 'assistant.kinds.vocabulary', { defaultValue: m.kind })}</Badge>
                <p className="whitespace-pre-wrap">{m.answer}</p>
              </div>
            </div>
          ))}
          {pending && (
            <div className="space-y-1.5">
              <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-primary/80 px-3 py-2 text-sm text-primary-fg" lang="en">
                {pending.question}
              </p>
              {pending.failed ? (
                <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
                  <span>{errorMessage(t, pending.failed)}</span>
                  <Button size="sm" variant="secondary" onClick={() => void send({ id: pending.id, question: pending.question })}>
                    ↻ {t('interviews.retry')}
                  </Button>
                </Alert>
              ) : (
                <p className="text-sm text-muted" role="status">
                  {t('assistant.thinking')}
                </p>
              )}
            </div>
          )}
        </div>
        {!readOnly &&
          (full ? (
            <p className="text-sm text-muted">{t('assistant.noMore')}</p>
          ) : (
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <Textarea
                data-testid="assistant-input"
                aria-label={t('assistant.inputLabel')}
                placeholder={t('assistant.placeholder')}
                className="min-h-11 flex-1 resize-none"
                rows={2}
                maxLength={500}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSubmit(e);
                  }
                }}
              />
              <Button data-testid="assistant-send" type="submit" disabled={input.trim().length < 3 || pending !== null} loading={pending !== null && !pending.failed}>
                {t('assistant.send')}
              </Button>
            </form>
          ))}
      </div>
    </Modal>
  );
}
