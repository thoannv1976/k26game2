import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CRITERION_KEYS, WRITING_PART_KEYS, type Assessment, type CriterionResult, type GradedResults } from '../../api/types';
import { Badge, Card, ProgressBar, SectionTitle, Table } from '../ui';

export function BulletList({ title, items, icon }: { title: ReactNode; items: string[]; icon?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">
        {icon && <span aria-hidden="true">{icon} </span>}
        {title}
      </h4>
      <ul className="list-disc space-y-1 pl-5 text-sm" lang="en">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export function SourceBadge({ source }: { source: CriterionResult['source'] }) {
  const { t } = useTranslation();
  return <Badge tone={source === 'teacher' ? 'success' : source === 'engine' ? 'neutral' : 'primary'}>{t(`results.source.${source}`)}</Badge>;
}

export function StatusBadge({ status }: { status: CriterionResult['status'] }) {
  const { t } = useTranslation();
  return <Badge tone={status === 'assessed' ? 'success' : status === 'partial' ? 'warn' : 'neutral'}>{t(`results.status.${status}`)}</Badge>;
}

/** Four criteria (reading 25, evidence 25, critical thinking 20, writing 30) with bars, status and source. */
export function CriteriaBars({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-4">
      {CRITERION_KEYS.map((k) => {
        const c = a.criteria[k];
        const pct = c.score === null ? 0 : c.score / c.max;
        return (
          <li key={k} data-testid={`criterion-${k}`} data-score={c.score ?? ''} className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{t(`criteria.${k}`)}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={c.status} />
                <SourceBadge source={c.source} />
                <span className="ml-1 font-bold tabular-nums">{c.score === null ? t('results.notAssessed') : `${c.score}/${c.max}`}</span>
              </span>
            </div>
            <ProgressBar value={c.score ?? 0} max={c.max} tone={c.score === null ? 'warn' : pct >= 0.7 ? 'success' : pct >= 0.45 ? 'primary' : 'danger'} label={t(`criteria.${k}`)} marker={c.status === 'partial' && c.assessedMax < c.max ? c.assessedMax / c.max : undefined} />
            {c.comment && (
              <p className="text-xs text-muted" lang="en">
                {c.comment}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function WritingParts({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  if (!a.writingParts) return null;
  const parts = a.writingParts;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{t('results.writingParts')}</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {WRITING_PART_KEYS.map((k) => (
          <li key={k} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex justify-between gap-2 font-semibold">
              <span>{t(`criteria.${k}`)}</span>
              <span className="tabular-nums">
                {parts[k].score}/{parts[k].max}
              </span>
            </div>
            <ProgressBar value={parts[k].score} max={parts[k].max} label={t(`criteria.${k}`)} />
            {parts[k].comment && (
              <p className="mt-1 text-xs text-muted" lang="en">
                {parts[k].comment}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FeedbackCard({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  const f = a.feedback;
  return (
    <Card className="space-y-4">
      <SectionTitle>💬 {t('results.feedback')}</SectionTitle>
      {!f ? (
        <p className="text-sm text-muted">{t('results.noFeedback')}</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <BulletList title={t('results.strengths')} items={f.strengths} icon="💪" />
            <BulletList title={t('results.improvements')} items={f.improvements} icon="🎯" />
          </div>
          {f.examples.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">🔍 {t('results.examples')}</h4>
              <ul className="space-y-2">
                {f.examples.map((e, i) => (
                  <li key={i} className="rounded-xl bg-surface-2 p-3 text-sm" lang="en">
                    <blockquote className="border-l-2 border-mark pl-2 font-serif italic">“{e.quote}”</blockquote>
                    <p className="mt-1">{e.comment}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.corrections.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">✏️ {t('results.corrections')}</h4>
              <ul className="space-y-2">
                {f.corrections.map((c, i) => (
                  <li key={i} className="rounded-xl border border-line p-3 text-sm" lang="en">
                    <span className="text-danger line-through">{c.original}</span> → <span className="font-semibold text-success">{c.corrected}</span>
                    <p className="mt-1 text-xs text-muted">{c.explanation}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.reasoningComment && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">⚖️ {t('results.reasoning')}</h4>
              <p className="text-sm" lang="en">
                {f.reasoningComment}
              </p>
            </div>
          )}
          <BulletList title={t('results.unsupportedUsed')} items={f.unsupportedClaimsUsed} icon="⚠️" />
          <div>
            <h4 className="mb-2 text-sm font-semibold">🧭 {t('results.recommendations')}</h4>
            <div className="grid gap-4 md:grid-cols-2">
              <BulletList title={t('results.vocabulary')} items={f.recommendations.vocabulary} />
              <BulletList title={t('results.grammar')} items={f.recommendations.grammar} />
              <BulletList title={t('results.readingSkills')} items={f.recommendations.readingSkills} />
              <BulletList title={t('results.reasoningSkills')} items={f.recommendations.reasoningSkills} />
            </div>
            {f.recommendations.nextWritingTask && (
              <p className="mt-3 rounded-xl bg-primary-soft px-3 py-2 text-sm">
                <span className="font-semibold">{t('results.nextWritingTask')}: </span>
                <span lang="en">{f.recommendations.nextWritingTask}</span>
              </p>
            )}
          </div>
        </>
      )}
      {a.qualityChecks.removedUnverifiableQuotes > 0 && <p className="text-xs text-muted">{t('results.removedQuotes', { count: a.qualityChecks.removedUnverifiableQuotes })}</p>}
    </Card>
  );
}

export function EvidenceCard({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  const e = a.evidence;
  return (
    <Card className="space-y-3">
      <SectionTitle>📌 {t('results.evidence')}</SectionTitle>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        <li>{t('results.keyFound', { found: e.keyFound, total: e.keyTotal })}</li>
        <li>{t('results.categorized', { correct: e.categorizedCorrect, total: e.categorizedTotal })}</li>
        <li>{t('results.links', { correct: e.linksCorrect, total: e.linksExpected })}</li>
        <li>{t('results.distractors', { count: e.distractorsCollected })}</li>
      </ul>
      {e.missedKeyEvidence.length > 0 && <BulletList title={t('results.missed')} items={e.missedKeyEvidence.map((m) => m.label)} icon="🕳️" />}
    </Card>
  );
}

/** MCQ answers are stored as option indexes: show the option text when the question options are known. */
function answerText(v: number | string | null, options?: string[]) {
  if (v === null) return '—';
  if (typeof v === 'number') return options?.[v] ?? `(${String.fromCharCode(65 + v)})`;
  return v.replace('_', ' ');
}

export function SolutionCard({ r, options = {} }: { r: GradedResults; options?: Record<string, string[] | undefined> }) {
  const { t } = useTranslation();
  const s = r.solution;
  const a = r.assessment;
  return (
    <Card className="space-y-5">
      <SectionTitle>🔓 {t('results.solution')}</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-success/40 bg-success-soft/50 p-3">
          <h4 className="text-sm font-semibold">{t('results.correctConclusion')}</h4>
          <p className="mt-1" lang="en">
            {s.conclusion}
          </p>
        </div>
        <div className={a.conclusion.correct ? 'rounded-xl border border-success/40 p-3' : 'rounded-xl border border-danger/40 p-3'}>
          <h4 className="text-sm font-semibold">
            {t('results.yourConclusion')} {a.conclusion.correct ? '✓' : '✗'}
          </h4>
          <p className="mt-1" lang="en">
            {a.conclusion.chosenText ?? t('results.noConclusion')}
          </p>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t('results.keyEvidence')}</h4>
        <ul className="space-y-2">
          {s.keyEvidence.map((k) => (
            <li key={k.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold" lang="en">
                  {k.label}
                </span>
                <Badge tone={k.found ? 'success' : 'danger'}>{k.found ? `✓ ${t('results.found')}` : `✗ ${t('results.notFound')}`}</Badge>
              </div>
              <p className="mt-1 text-muted" lang="en">
                {k.explanation}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <BulletList title={t('results.unsupportedClaims')} items={s.unsupportedClaims} icon="⚠️" />
      <BulletList title={t('results.keyPoints')} items={s.writingKeyPoints} icon="✍️" />
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t('results.answers')}</h4>
        <Table>
          <thead>
            <tr>
              <th>{t('results.question')}</th>
              <th>{t('results.yourAnswer')}</th>
              <th>{t('results.expected')}</th>
            </tr>
          </thead>
          <tbody>
            {s.answers.map((x) => (
              <tr key={x.id} className="align-top">
                <td lang="en">{x.prompt}</td>
                <td lang="en">
                  {x.correct === true ? '✓ ' : x.correct === false ? '✗ ' : ''}
                  {answerText(x.studentAnswer, options[x.id])}
                </td>
                <td lang="en" className="text-muted">
                  {x.expected}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
