import {
  ASSESSMENT_DISCLAIMER,
  RUBRIC,
  RUBRIC_VERSION,
  computeAchievements,
  conclusionScore,
  evidenceScore,
  gamePoints,
  readingParts,
  readingScore,
  recommendNextCase,
} from '@ed/game-engine';
import { PROMPT_VERSION, verifyGrade, type GradeOutput } from '@ed/ai';
import type { CaseDossier, CourseDoc, TenantDoc, UserDoc } from '@ed/shared';
import type { Member } from '../auth.js';
import type { Deps } from '../deps.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { paths } from '../paths.js';
import { recordUsage, reserveAiCall } from '../quota.js';
import { getCaseVersion, getTenant, listApprovedCases } from '../tenants.js';
import { CRITERION_KEYS, type AssessmentDoc, type CriterionKey, type CriterionResult, type FinalReportDoc, type SessionDoc, type TeacherReview } from '../types.js';
import { syncGrade } from '../lti/gradeSync.js';
import { canViewStudent } from './access.js';
import { withRetry } from './retry.js';

const GRADING_STALE_MS = 3 * 60_000;

export function totals(criteria: Record<CriterionKey, CriterionResult>) {
  let total = 0;
  let maxAssessed = 0;
  for (const c of Object.values(criteria)) {
    if (c.score !== null && c.assessedMax > 0) {
      total += c.score;
      maxAssessed += c.assessedMax;
    }
  }
  return { total, maxAssessed, percent: maxAssessed ? Math.round((total / maxAssessed) * 100) : 0 };
}

export function applyReview(criteria: Record<CriterionKey, CriterionResult>, review: TeacherReview | null) {
  if (!review) return { criteria, ...totals(criteria) };
  const out = { ...criteria };
  for (const [k, v] of Object.entries(review.scores) as [CriterionKey, number][]) {
    const c = out[k];
    if (!c || v === undefined) continue;
    out[k] = { ...c, score: Math.max(0, Math.min(c.max, v)), assessedMax: c.max, status: 'assessed', source: 'teacher' };
  }
  return { criteria: out, ...totals(out) };
}

/** Builds the assessment from the engine scores and (optional) AI grade. Pure function – unit tested. */
export function buildCriteria(d: CaseDossier, s: SessionDoc, ai: GradeOutput | null) {
  const rp = readingParts(d, s.state);
  const explainEarned = ai ? ai.explainAnswers.reduce((n, e) => n + e.score, 0) : null;
  const reading = readingScore(rp, rp.explainTotal ? explainEarned : 0);
  const ev = evidenceScore(d, s.state);
  const concl = conclusionScore(d, s.state);
  const criteria: Record<CriterionKey, CriterionResult> = {
    reading: {
      max: RUBRIC.reading,
      assessedMax: RUBRIC.reading,
      score: reading.score,
      status: reading.assessedFraction >= 1 ? 'assessed' : 'partial',
      source: rp.explainTotal ? 'engine+ai' : 'engine',
      comment: `${rp.objectiveEarned}/${rp.objectiveTotal} objective points${rp.explainTotal ? (explainEarned === null ? '; open answers not assessed (scaled on objective questions)' : `; open answers ${explainEarned}/${rp.explainTotal}`) : ''}.`,
    },
    evidence: {
      max: RUBRIC.evidence,
      assessedMax: RUBRIC.evidence,
      score: ev.score,
      status: 'assessed',
      source: 'engine',
      comment: `${ev.keyFound}/${ev.keyTotal} key evidence found; ${ev.categorizedCorrect}/${ev.categorizedTotal} correctly categorized; ${ev.linksCorrect}/${ev.linksExpected} expected links.`,
    },
    criticalThinking: ai
      ? {
          max: RUBRIC.criticalThinking,
          assessedMax: RUBRIC.criticalThinking,
          score: concl.score + ai.reasoning.score,
          status: 'assessed',
          source: 'engine+ai',
          comment: `Conclusion ${concl.correct ? 'supported by the evidence' : 'not the best-supported one'} (${concl.score}/10). Reasoning: ${ai.reasoning.comment}`,
        }
      : {
          max: RUBRIC.criticalThinking,
          assessedMax: 10,
          score: concl.score,
          status: 'partial',
          source: 'engine',
          comment: `Conclusion ${concl.correct ? 'supported by the evidence' : 'not the best-supported one'} (${concl.score}/10). Reasoning quality not assessed.`,
        },
    writing: ai
      ? {
          max: RUBRIC.writing,
          assessedMax: RUBRIC.writing,
          score: ai.writing.taskAchievement.score + ai.writing.coherence.score + ai.writing.vocabulary.score + ai.writing.grammar.score,
          status: 'assessed',
          source: 'ai',
          comment: ai.writing.taskAchievement.comment,
        }
      : { max: RUBRIC.writing, assessedMax: 0, score: null, status: 'not_assessed', source: 'ai', comment: 'Not assessed: AI grading unavailable. Your teacher can review your report.' },
  };
  return { criteria, ev, concl, rp };
}

async function grade(deps: Deps, tenant: TenantDoc, d: CaseDossier, s: SessionDoc, report: FinalReportDoc, aiAllowed: boolean) {
  const { rp } = buildCriteria(d, s, null);
  const model = deps.config.geminiModel ?? tenant.aiConfig.assessmentModel;
  if (!aiAllowed) return { ai: null as GradeOutput | null, status: 'skipped' as const, removed: 0, model };
  const started = Date.now();
  try {
    const opt = d.conclusion.options;
    const r = await withRetry(
      () =>
        deps.ai.grade({
          dossier: d,
          explainAnswers: rp.explainAnswers,
          collectedEvidence: Object.keys(s.state.collected).map((id) => {
            const e = d.evidence.find((x) => x.id === id)!;
            return { id, label: e.label, studentCategory: s.state.board[id]?.category ?? null, studentNote: s.state.board[id]?.note ?? '', canonicalCategory: e.category, explanation: e.explanation };
          }),
          conclusion: s.state.conclusion
            ? {
                optionText: opt.find((o) => o.id === s.state.conclusion!.optionId)?.text ?? '',
                isCorrect: s.state.conclusion.optionId === d.conclusion.correctOptionId,
                justification: s.state.conclusion.justification,
                supportingLabels: s.state.conclusion.supportingEvidenceIds.map((id) => d.evidence.find((e) => e.id === id)?.label ?? id),
              }
            : null,
          report: report.text,
          wordCount: report.wordCount,
          model,
          maxOutputTokens: tenant.quotas.maxOutputTokens,
        }),
      { retries: deps.config.aiMaxRetries, timeoutMs: deps.config.gradingTimeoutMs },
    );
    void recordUsage(deps, tenant, { kind: 'grade', uid: s.uid, sessionId: s.id, courseId: s.courseId, model, ...r.usage, ok: true, latencyMs: Date.now() - started });
    const explainMax = Object.fromEntries(rp.explainAnswers.map((e) => [e.questionId, e.points]));
    const v = verifyGrade(d, report.text, explainMax, r.output);
    return { ai: v.grade, status: 'ok' as const, removed: v.removed, model };
  } catch (e) {
    console.error('AI grading failed', e);
    void recordUsage(deps, tenant, { kind: 'grade', uid: s.uid, sessionId: s.id, courseId: s.courseId, model, ok: false, latencyMs: Date.now() - started });
    return { ai: null, status: 'failed' as const, removed: 0, model };
  }
}

/**
 * Asynchronous grading: the first status check after submission claims the session and grades it;
 * concurrent checks see "grading". Never grades twice (assessment id = session id).
 */
export async function ensureGraded(deps: Deps, tenantId: string, sessionId: string, opts: { force?: boolean } = {}): Promise<{ status: SessionDoc['status'] }> {
  const p = paths(deps.db);
  const ref = p.session(tenantId, sessionId);
  const tenant = await getTenant(deps, tenantId);
  const claim = await deps.db.runTransaction(async (tx) => {
    const [sSnap, aSnap] = await Promise.all([tx.get(ref), tx.get(p.assessment(tenantId, sessionId))]);
    const s = sSnap.data() as SessionDoc;
    if (aSnap.exists && !opts.force) return { status: 'graded' as const };
    const now = deps.now();
    const stale = s.status === 'grading' && (!s.lockSince || now.getTime() - new Date(s.lockSince).getTime() > GRADING_STALE_MS);
    if (!(s.status === 'submitted' || stale || (opts.force && s.status === 'graded'))) return { status: s.status };
    const course = s.courseId ? ((await tx.get(p.course(tenantId, s.courseId))).data() as CourseDoc | undefined) : undefined;
    let aiAllowed = true;
    try {
      const q = await reserveAiCall(deps, tx, tenant, s.uid, s.courseId, course?.monthlyBudgetUsd ?? null);
      q.commit();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'QUOTA_EXCEEDED' || e.code === 'BUDGET_EXCEEDED')) aiAllowed = false;
      else throw e;
    }
    tx.update(ref, { status: 'grading', lockId: 'grading', lockSince: now.toISOString(), gradingAttempts: s.gradingAttempts + 1 });
    return { status: 'claimed' as const, session: s, aiAllowed };
  });
  if (claim.status !== 'claimed') return { status: claim.status };

  const s = claim.session;
  let assessed: AssessmentDoc;
  let gradedAt: string;
  try {
    const d = await getCaseVersion(deps, tenantId, s.caseId, s.caseVersion);
    const report = (await p.report(tenantId, sessionId).get()).data() as FinalReportDoc;
    const g = await grade(deps, tenant, d, s, report, claim.aiAllowed);
    const { criteria, ev, concl, rp } = buildCriteria(d, s, g.ai);
    const t = totals(criteria);
    const solved = concl.correct;
    const allCases = await listApprovedCases(deps, tenantId);

    gradedAt = deps.now().toISOString();
    assessed = await deps.db.runTransaction(async (tx) => {
      const userRef = p.user(tenantId, s.uid);
      const aRef = p.assessment(tenantId, sessionId);
      const [uSnap, aSnap] = await Promise.all([tx.get(userRef), tx.get(aRef)]);
      const user = uSnap.data() as UserDoc | undefined;
      const prev = aSnap.data() as AssessmentDoc | undefined;
      const firstTime = !prev;
      const completed = user?.completedCaseIds ?? [];
      const points = gamePoints(d, s.state, solved);
      const writingScore = criteria.writing.score;
      const newAchievements = firstTime ? computeAchievements(allCases.map((c) => c.dossier.id), d, s.state, solved, writingScore, completed, user?.achievements ?? []) : (prev?.newAchievements ?? []);
      const recommendation = recommendNextCase(allCases.map((c) => ({ id: c.dossier.id, level: c.dossier.level })), d, solved, t.percent, completed);
      const reviewed = applyReview(criteria, prev?.teacherReview ?? null);
      const doc: AssessmentDoc = {
        id: sessionId,
        tenantId,
        uid: s.uid,
        sessionId,
        caseId: s.caseId,
        caseVersion: s.caseVersion,
        level: d.level,
        courseId: s.courseId,
        solved,
        criteria,
        writingParts: g.ai
          ? {
              taskAchievement: { ...g.ai.writing.taskAchievement, max: 10 },
              coherence: { ...g.ai.writing.coherence, max: 7 },
              vocabulary: { ...g.ai.writing.vocabulary, max: 7 },
              grammar: { ...g.ai.writing.grammar, max: 6 },
            }
          : null,
        evidence: ev,
        conclusion: {
          correct: concl.correct,
          requiredCited: concl.requiredCited,
          requiredTotal: concl.requiredTotal,
          weakSupport: concl.weakSupport,
          correctText: d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text,
          chosenText: d.conclusion.options.find((o) => o.id === s.state.conclusion?.optionId)?.text ?? null,
        },
        readingDetail: {
          objectiveEarned: rp.objectiveEarned,
          objectiveTotal: rp.objectiveTotal,
          explain: g.ai ? g.ai.explainAnswers.map((e) => ({ questionId: e.questionId, score: e.score, max: rp.explainAnswers.find((x) => x.questionId === e.questionId)?.points ?? 0, comment: e.comment })) : null,
        },
        ...t,
        finalPercent: reviewed.percent,
        aiStatus: g.status,
        feedback: g.ai
          ? {
              strengths: g.ai.strengths,
              improvements: g.ai.improvements,
              examples: g.ai.examples,
              corrections: g.ai.corrections,
              reasoningComment: g.ai.reasoning.comment,
              unsupportedClaimsUsed: g.ai.reasoning.unsupportedClaimsUsed,
              recommendations: g.ai.recommendations,
            }
          : null,
        wordCount: report.wordCount,
        recommendation,
        gamePoints: points,
        newAchievements,
        versions: { rubric: RUBRIC_VERSION, prompt: PROMPT_VERSION, model: g.status === 'ok' ? `${deps.ai.name}:${g.model}` : 'none', caseVersion: s.caseVersion },
        qualityChecks: { removedUnverifiableQuotes: g.removed },
        teacherReview: prev?.teacherReview ?? null,
        disclaimer: ASSESSMENT_DISCLAIMER,
        createdAt: prev?.createdAt ?? deps.now().toISOString(),
      };
      tx.set(aRef, doc);
      tx.update(p.session(tenantId, sessionId), { status: 'graded', gradedAt, lockId: null, lockSince: null });
      if (user && firstTime) {
        const best = Math.max(user.bestPercent?.[d.id] ?? 0, t.percent);
        tx.update(userRef, {
          xp: (user.xp ?? 0) + points.xp,
          detectivePoints: (user.detectivePoints ?? 0) + points.detectivePoints,
          completedCaseIds: solved ? [...new Set([...completed, d.id])] : completed,
          bestPercent: { ...(user.bestPercent ?? {}), [d.id]: best },
          achievements: [...(user.achievements ?? []), ...newAchievements],
          level: recommendation.nextLevel === 'B2' && user.level === 'B1' ? 'B2' : user.level,
        });
      }
      return doc;
    });
  } catch (e) {
    await ref.update({ status: 'submitted', lockId: null, lockSince: null }).catch(() => undefined);
    throw e;
  }
  // Every path that decides a score (first status check after submission, teacher regrade) ends here.
  // Reports to the LMS for LTI assignments only; never throws.
  await syncGrade(deps, tenantId, assessed, gradedAt);
  return { status: 'graded' };
}

export async function getResults(deps: Deps, m: Member, sessionId: string) {
  const p = paths(deps.db);
  const s = (await p.session(m.tenantId, sessionId).get()).data() as SessionDoc | undefined;
  if (!s) throw notFound('Investigation');
  if (s.uid !== m.uid && !(await canViewStudent(deps, m, s.uid))) throw forbidden();
  if (s.status === 'active' || s.status === 'abandoned') return { status: s.status, assessment: null };
  let status: SessionDoc['status'] = s.status;
  if (status !== 'graded') status = (await ensureGraded(deps, m.tenantId, sessionId)).status;
  if (status !== 'graded') return { status, assessment: null };
  const [a, report, d] = await Promise.all([
    p.assessment(m.tenantId, sessionId).get().then((x) => x.data() as AssessmentDoc),
    p.report(m.tenantId, sessionId).get().then((x) => x.data() as FinalReportDoc),
    getCaseVersion(deps, m.tenantId, s.caseId, s.caseVersion),
  ]);
  const reviewed = applyReview(a.criteria, a.teacherReview);
  return {
    status,
    assessment: { ...a, criteria: reviewed.criteria, aiCriteria: a.criteria, finalPercent: reviewed.percent },
    report: { text: report.text, wordCount: report.wordCount, submittedAt: report.submittedAt },
    // After submission the student may see the solution to learn from it.
    solution: {
      conclusion: a.conclusion.correctText,
      keyEvidence: d.evidence.filter((e) => e.key).map((e) => ({ id: e.id, label: e.label, documentId: e.documentId, found: Boolean(s.state.collected[e.id]), explanation: e.explanation })),
      unsupportedClaims: d.conclusion.unsupportedClaims,
      writingKeyPoints: d.writingTask.keyPoints,
      answers: d.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        studentAnswer: s.state.answers[q.id]?.value ?? null,
        correct: s.state.answers[q.id]?.correct ?? null,
        expected: q.type === 'mcq' ? q.options[q.correctIndex] : q.type === 'tfng' ? q.answer.replace('_', ' ') : q.type === 'short' ? q.acceptable[0] : q.sampleAnswer,
      })),
    },
    case: { id: d.id, title: d.title, level: d.level },
  };
}

export async function reviewAssessment(deps: Deps, m: Member, sessionId: string, input: { scores: Partial<Record<CriterionKey, number>>; comment: string }) {
  const p = paths(deps.db);
  const ref = p.assessment(m.tenantId, sessionId);
  const a = (await ref.get()).data() as AssessmentDoc | undefined;
  if (!a) throw notFound('Assessment');
  if (a.uid === m.uid || !(await canViewStudent(deps, m, a.uid))) throw forbidden('You cannot review this student');
  for (const [k, v] of Object.entries(input.scores) as [CriterionKey, number][]) {
    if (!CRITERION_KEYS.includes(k) || v > a.criteria[k].max) throw new ApiError('VALIDATION', `Score for ${k} must be between 0 and ${a.criteria[k]?.max}`);
  }
  const changed = Object.entries(input.scores).some(([k, v]) => a.criteria[k as CriterionKey].score !== v);
  const review: TeacherReview = { reviewerUid: m.uid, reviewerName: m.name, scores: input.scores, comment: input.comment, status: changed ? 'adjusted' : 'confirmed', reviewedAt: deps.now().toISOString() };
  const r = applyReview(a.criteria, review);
  await ref.update({ teacherReview: review, finalPercent: r.percent });
  return { ...a, teacherReview: review, finalPercent: r.percent };
}
