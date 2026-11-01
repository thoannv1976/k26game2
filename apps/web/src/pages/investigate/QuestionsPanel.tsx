import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { AnswerResponse, InvQuestion } from '../../api/types';
import { errorMessage } from '../../i18n/errors';
import { wordCount } from '../../lib/text';
import { Badge, Button, Card, ConfirmModal, EmptyState, Input, Textarea, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useWorkspace } from './session';

type Value = number | string;

function answerLabel(q: InvQuestion, v: Value, t: ReturnType<typeof useTranslation>['t']): string {
  if (q.type === 'mcq' && q.options && typeof v === 'number') return q.options[v] ?? String(v);
  if (q.type === 'tfng') return t(`questions.tfng.${String(v) as 'true'}`);
  return String(v);
}

function QuestionCard({ q, index, onSubmit, busy, readOnly }: { q: InvQuestion; index: number; onSubmit: (q: InvQuestion, v: Value) => void; busy: boolean; readOnly: boolean }) {
  const { t } = useTranslation();
  const { data, goTo } = useWorkspace();
  const [value, setValue] = useState<Value | null>(null);
  const answered = q.answer !== null;
  const docs = q.documentIds.map((id) => data.investigation.documents.find((d) => d.id === id)).filter(Boolean);
  const disabled = answered || readOnly;
  const ready = value !== null && (typeof value === 'number' || value.trim().length > 0);
  const tooLong = q.type === 'short' && q.maxWords !== undefined && typeof value === 'string' && wordCount(value) > q.maxWords;
  const name = `q-${q.id}`;

  return (
    <Card as="article" className={cx('space-y-3', answered && 'bg-surface-2/60')}>
      <div data-testid={`question-${q.id}`} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-mono font-bold">Q{index + 1}</span>
          <Badge>{t('questions.points', { count: q.points })}</Badge>
          <Badge tone={q.required ? 'primary' : 'neutral'}>{q.required ? t('questions.required') : t('questions.optional')}</Badge>
          <span className="flex flex-wrap gap-1">
            {t('questions.basedOn', { docs: '' })}
            {docs.map((d) => (
              <button key={d!.id} type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => goTo('documents', d!.id)} lang="en">
                {d!.title}
              </button>
            ))}
          </span>
        </div>
        <h3 className="font-semibold" lang="en" id={`${name}-label`}>
          {q.prompt}
        </h3>
        {q.type === 'tfng' && q.statement && (
          <blockquote className="rounded-xl border-l-4 border-primary bg-surface-2 px-4 py-2 font-serif" lang="en">
            <span className="sr-only">{t('questions.statement')}: </span>
            {q.statement}
          </blockquote>
        )}

        {answered ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium" lang="en">
              {t('questions.yourAnswer', { answer: answerLabel(q, q.answer!.value, t) })}
            </span>
            {q.answer!.correct === true && <Badge tone="success">✓ {t('questions.correct')}</Badge>}
            {q.answer!.correct === false && <Badge tone="danger">✗ {t('questions.incorrect')}</Badge>}
            {q.answer!.correct === null && <Badge tone="warn">⏳ {t('questions.assessedLater')}</Badge>}
          </div>
        ) : (
          <>
            {q.type === 'mcq' && q.options && (
              <fieldset className="space-y-2" aria-labelledby={`${name}-label`}>
                {q.options.map((o, i) => (
                  <label key={i} className={cx('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2', value === i ? 'border-primary bg-primary-soft' : 'border-line')}>
                    <input type="radio" name={name} className="mt-1 h-4 w-4 accent-[var(--ed-primary)]" checked={value === i} onChange={() => setValue(i)} disabled={disabled} />
                    <span lang="en">{o}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {q.type === 'tfng' && (
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby={`${name}-label`}>
                {(['true', 'false', 'not_given'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={value === v}
                    disabled={disabled}
                    onClick={() => setValue(v)}
                    className={cx('min-h-11 rounded-xl border px-2 text-sm font-semibold', value === v ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:border-primary')}
                  >
                    {t(`questions.tfng.${v}`)}
                  </button>
                ))}
              </div>
            )}
            {q.type === 'short' && q.maxWords !== undefined && (
              <div>
                <Input aria-labelledby={`${name}-label`} value={typeof value === 'string' ? value : ''} onChange={(e) => setValue(e.target.value)} disabled={disabled} maxLength={200} lang="en" />
                <p className={cx('mt-1 text-xs', tooLong ? 'text-danger' : 'text-muted')}>{t('questions.shortHint', { count: q.maxWords })}</p>
              </div>
            )}
            {q.type === 'explain' && (
              <div>
                <Textarea aria-labelledby={`${name}-label`} value={typeof value === 'string' ? value : ''} onChange={(e) => setValue(e.target.value)} disabled={disabled} maxLength={1500} lang="en" rows={4} />
                <p className="mt-1 text-xs text-muted">{t('questions.explainHint')}</p>
              </div>
            )}
            {!readOnly && (
              <Button data-testid={`question-submit-${q.id}`} onClick={() => value !== null && onSubmit(q, typeof value === 'string' ? value.trim() : value)} disabled={!ready || busy}>
                {t('questions.submit')}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export function QuestionsPanel() {
  const { t } = useTranslation();
  const { sid, data, readOnly, apply } = useWorkspace();
  const toast = useToast();
  const [pending, setPending] = useState<{ q: InvQuestion; v: Value } | null>(null);
  const inv = data.investigation;
  const answer = useMutation({
    mutationFn: (p: { q: InvQuestion; v: Value }) => api.post<AnswerResponse>(`/api/sessions/${sid}/answers`, { questionId: p.q.id, value: p.v }),
    onSuccess: (r) => {
      apply(r);
      setPending(null);
      if (r.result.correct === true) toast.success(`✓ ${t('questions.correct')}`);
      else if (r.result.correct === false) toast.show(`✗ ${t('questions.incorrect')}`, 'warn');
      else toast.show(t('questions.assessedLater'));
    },
    onError: (e) => {
      setPending(null);
      toast.error(errorMessage(t, e));
    },
  });
  const done = inv.questions.filter((q) => q.answer).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">{t('questions.title')}</h2>
          <p className="text-sm text-muted">{t('questions.intro')}</p>
        </div>
        <Badge tone="primary">{t('questions.answered', { done, total: inv.questions.length })}</Badge>
      </div>
      {inv.questions.length === 0 ? (
        <EmptyState icon="❓" title={t('questions.none')} />
      ) : (
        inv.questions.map((q, i) => <QuestionCard key={q.id} q={q} index={i} busy={answer.isPending} readOnly={readOnly} onSubmit={(qq, v) => setPending({ q: qq, v })} />)
      )}
      {inv.lockedQuestionCount > 0 && <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">🔒 {t('questions.locked', { count: inv.lockedQuestionCount })}</p>}
      <ConfirmModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => pending && answer.mutate(pending)}
        title={t('questions.confirmTitle')}
        confirmLabel={t('questions.submit')}
        confirmTestId="question-confirm"
        loading={answer.isPending}
      >
        <p>{t('questions.confirmBody')}</p>
        {pending && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 font-medium" lang="en">
            {answerLabel(pending.q, pending.v, t)}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
