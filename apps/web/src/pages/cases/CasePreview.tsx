import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CaseDossier, Unlock } from '@ed/shared';
import { Avatar } from '../../components/Avatar';
import { DocumentView } from '../../components/DocumentView';
import { Badge, LevelBadge, cx } from '../../components/ui';
import { useLocalized } from '../../i18n';

type Section = 'overview' | 'documents' | 'characters' | 'evidence' | 'questions' | 'conclusion' | 'writing';

function UnlockText({ u }: { u: Unlock }) {
  const { t } = useTranslation();
  if (u.type === 'start') return <>{t('caseBank.pv.unlockStart')}</>;
  if (u.type === 'fact') return <>{t('caseBank.pv.unlockFact', { id: u.factId })}</>;
  if (u.type === 'question') return <>{t('caseBank.pv.unlockQuestion', { id: u.questionId })}</>;
  return <>{t('caseBank.pv.unlockEvidence', { id: u.evidenceId })}</>;
}

const CAT_TONE = { verified: 'success', unverified: 'warn', irrelevant: 'neutral' } as const;

/** Readable review screen of a full dossier (teachers only): everything the AI and engine will use. */
export function CasePreview({ d }: { d: CaseDossier }) {
  const { t } = useTranslation();
  const { L } = useLocalized();
  const [section, setSection] = useState<Section>('overview');
  const [docIdx, setDocIdx] = useState(0);
  const tabs: [Section, string][] = [
    ['overview', t('caseBank.pv.overview')],
    ['documents', t('caseBank.pv.documents', { count: d.documents.length })],
    ['characters', t('caseBank.pv.characters', { count: d.characters.length })],
    ['evidence', t('caseBank.pv.evidence', { count: d.evidence.length })],
    ['questions', t('caseBank.pv.questions', { count: d.questions.length })],
    ['conclusion', t('caseBank.pv.conclusion')],
    ['writing', t('caseBank.pv.writing')],
  ];
  const doc = d.documents[docIdx];
  const evLabel = (id: string) => d.evidence.find((e) => e.id === id)?.label ?? id;
  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-1 border-b border-line" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={section === k}
              onClick={() => setSection(k)}
              className={cx('-mb-px min-h-11 border-b-2 px-3 text-sm font-semibold whitespace-nowrap', section === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {section === 'overview' && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold">{d.id}</span>
            <LevelBadge level={d.level} />
            <Badge>{t('office.minutes', { count: d.estimatedMinutes })}</Badge>
            <Badge>{t('office.xp', { count: d.xpReward })}</Badge>
          </div>
          <h3 className="font-serif text-xl font-bold">
            {d.title.en} <span className="text-muted">/ {d.title.vi}</span>
          </h3>
          <p>{L(d.summary)}</p>
          <p className="text-muted" lang="en">
            {d.role} · {d.setting} · {d.topic}
          </p>
          <div className="rounded-xl bg-surface-2 p-3 whitespace-pre-line">{L(d.briefing)}</div>
          <ol className="list-decimal pl-5">
            {d.objectives.map((o, i) => (
              <li key={i}>{L(o)}</li>
            ))}
          </ol>
          <h4 className="font-semibold">{t('caseBank.pv.limits')}</h4>
          <p className="text-muted">
            {t('briefing.interviewLimit', { count: d.limits.interviewQuestionsPerCharacter })} · {t('briefing.assistantLimit', { count: d.limits.assistantRequests })} · {t('briefing.minEvidence', { count: d.limits.minEvidenceToSubmit })} ·{' '}
            {t('briefing.timeLimit', { count: d.limits.timeMinutes })}
          </p>
          <h4 className="font-semibold">{t('caseBank.pv.hints')}</h4>
          <ul className="space-y-1" lang="en">
            {Object.entries(d.hints).map(([k, hs]) => (
              <li key={k}>
                <span className="font-semibold">{t(`hints.stages.${k as 'documents'}`)}:</span> {hs.join(' → ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {section === 'documents' && doc && (
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="space-y-1">
            {d.documents.map((x, i) => (
              <li key={x.id}>
                <button type="button" onClick={() => setDocIdx(i)} className={cx('w-full rounded-lg border px-3 py-2 text-left text-sm', i === docIdx ? 'border-primary bg-primary-soft' : 'border-line')}>
                  <span className="block font-mono text-xs text-muted">{x.id}</span>
                  <span className="font-medium" lang="en">
                    {x.title}
                  </span>
                  <span className="block text-xs text-muted">
                    {t('caseBank.pv.unlock')}: <UnlockText u={x.unlock} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <DocumentView doc={doc} marks={d.evidence.filter((e) => e.documentId === doc.id).map((e) => e.excerpt)} interactive testId="preview-doc-body" />
        </div>
      )}

      {section === 'characters' && (
        <ul className="space-y-4">
          {d.characters.map((c) => (
            <li key={c.id} className="space-y-2 rounded-xl border border-line p-3 text-sm">
              <div className="flex items-center gap-3">
                <Avatar avatar={c.avatar} name={c.name} size={48} />
                <div>
                  <div className="font-semibold">
                    {c.name} <span className="font-mono text-xs text-muted">{c.id}</span>
                  </div>
                  <div className="text-muted" lang="en">
                    {c.role}
                  </div>
                </div>
              </div>
              <p lang="en">
                <span className="font-semibold">{t('caseBank.pv.personality')}:</span> {c.personality}
              </p>
              <p lang="en">{c.background}</p>
              <p lang="en">
                <span className="font-semibold">{t('caseBank.pv.greeting')}:</span> “{c.greeting}”
              </p>
              <h4 className="font-semibold">{t('caseBank.pv.facts')}</h4>
              <ul className="space-y-1" lang="en">
                {c.facts.map((f) => (
                  <li key={f.id} className="rounded-lg bg-surface-2 px-2 py-1">
                    <span className="font-mono text-xs text-muted">{f.id}</span> {f.text}
                    <span className="block text-xs text-muted">
                      <UnlockText u={f.condition} /> · {t('caseBank.pv.keywords')}: {f.keywords.join(', ')}
                      {f.unlocksDocumentId && ` · ${t('caseBank.pv.unlocksDoc', { id: f.unlocksDocumentId })}`}
                    </span>
                  </li>
                ))}
              </ul>
              {c.restricted.length > 0 && (
                <>
                  <h4 className="font-semibold text-danger">{t('caseBank.pv.restricted')}</h4>
                  <ul className="list-disc pl-5" lang="en">
                    {c.restricted.map((r, i) => (
                      <li key={i}>
                        {r.topic} <span className="text-xs text-muted">({r.forbiddenPhrases.join(' · ')})</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {section === 'evidence' && (
        <div className="space-y-4">
          <ul className="space-y-2">
            {d.evidence.map((e) => (
              <li key={e.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold" lang="en">
                    {e.label}
                  </span>
                  <Badge tone={CAT_TONE[e.category]}>{t(`board.columns.${e.category}`)}</Badge>
                  {e.key && <Badge tone="danger">{t('caseBank.pv.key')}</Badge>}
                  <span className="font-mono text-xs text-muted">
                    {e.id} · {e.documentId}
                  </span>
                </div>
                <blockquote className="mt-1 border-l-2 border-mark pl-2 font-serif italic" lang="en">
                  “{e.excerpt}”
                </blockquote>
                <p className="mt-1 text-muted" lang="en">
                  {e.explanation}
                </p>
              </li>
            ))}
          </ul>
          {d.links.length > 0 && (
            <div>
              <h4 className="font-semibold">{t('caseBank.pv.links')}</h4>
              <ul className="list-disc pl-5 text-sm" lang="en">
                {d.links.map((l, i) => (
                  <li key={i}>
                    {evLabel(l.a)} ⟷ {evLabel(l.b)} <span className="text-muted">({l.relation})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {section === 'questions' && (
        <ol className="space-y-2">
          {d.questions.map((q, i) => (
            <li key={q.id} className="rounded-xl border border-line p-3 text-sm" lang="en">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-mono font-bold">
                  Q{i + 1} · {q.id}
                </span>
                <Badge>{q.type}</Badge>
                <Badge>{t('questions.points', { count: q.points })}</Badge>
                {q.required && <Badge tone="primary">{t('questions.required')}</Badge>}
                <span>{q.documentIds.join(', ')}</span>
              </div>
              <p className="mt-1 font-medium">{q.prompt}</p>
              {q.type === 'mcq' && (
                <ul className="mt-1 space-y-0.5">
                  {q.options.map((o, j) => (
                    <li key={j} className={j === q.correctIndex ? 'font-semibold text-success' : ''}>
                      {j === q.correctIndex ? '✓' : '○'} {o}
                    </li>
                  ))}
                </ul>
              )}
              {q.type === 'tfng' && (
                <p className="mt-1">
                  “{q.statement}” → <span className="font-semibold text-success">{q.answer.replace('_', ' ')}</span>
                </p>
              )}
              {q.type === 'short' && (
                <p className="mt-1">
                  {t('caseBank.pv.answer')}: <span className="font-semibold text-success">{q.acceptable.join(' / ')}</span> (≤ {q.maxWords})
                </p>
              )}
              {q.type === 'explain' && (
                <div className="mt-1">
                  <ul className="list-disc pl-5">
                    {q.keyPoints.map((k, j) => (
                      <li key={j}>{k}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted italic">{q.sampleAnswer}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {section === 'conclusion' && (
        <div className="space-y-3 text-sm" lang="en">
          <p className="font-semibold">{d.conclusion.question}</p>
          <ul className="space-y-1">
            {d.conclusion.options.map((o) => (
              <li key={o.id} className={o.id === d.conclusion.correctOptionId ? 'font-semibold text-success' : ''}>
                {o.id === d.conclusion.correctOptionId ? '✓' : '○'} {o.text}
              </li>
            ))}
          </ul>
          <p>
            <span className="font-semibold">{t('caseBank.pv.required')}:</span> {d.conclusion.requiredEvidenceIds.map(evLabel).join(' · ')}
          </p>
          <p className="text-muted">{t('caseBank.pv.minSupporting', { count: d.conclusion.minSupporting })}</p>
          <div>
            <h4 className="font-semibold">{t('caseBank.pv.unsupported')}</h4>
            <ul className="list-disc pl-5">
              {d.conclusion.unsupportedClaims.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {section === 'writing' && (
        <div className="space-y-3 text-sm" lang="en">
          <div className="flex flex-wrap gap-2">
            <Badge>{d.writingTask.type}</Badge>
            <Badge>
              {d.writingTask.minWords}–{d.writingTask.maxWords} words
            </Badge>
          </div>
          <p>{d.writingTask.prompt}</p>
          <p className="text-muted">{d.writingTask.audience}</p>
          <p>
            <span className="font-semibold">{t('caseBank.pv.sections')}:</span> {d.writingTask.sections.join(' · ')}
          </p>
          <div>
            <h4 className="font-semibold">{t('caseBank.pv.keyPoints')}</h4>
            <ul className="list-disc pl-5">
              {d.writingTask.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
