/**
 * Deterministic scoring. AI-graded parts (explain answers, reasoning quality, writing) are merged
 * by the API; when the AI is unavailable those parts are reported as "not assessed".
 */
import type { CaseDossier, Level } from '@ed/shared';
import type { InvestigationState } from './state.js';

export const RUBRIC = { reading: 25, evidence: 25, criticalThinking: 20, writing: 30 } as const;
export const RUBRIC_VERSION = 'ed-rubric-1.0';
export const ASSESSMENT_DISCLAIMER =
  'AI-assisted learning feedback. This is not an official score. / Phản hồi học tập do AI hỗ trợ, không phải điểm chính thức.';

export interface ReadingParts {
  objectiveEarned: number;
  objectiveTotal: number;
  explainTotal: number;
  /** explain question id → student's text */
  explainAnswers: { questionId: string; answer: string; points: number; keyPoints: string[]; prompt: string }[];
}

export function readingParts(d: CaseDossier, s: InvestigationState): ReadingParts {
  let objectiveEarned = 0;
  let objectiveTotal = 0;
  let explainTotal = 0;
  const explainAnswers: ReadingParts['explainAnswers'] = [];
  for (const q of d.questions) {
    if (q.type === 'explain') {
      explainTotal += q.points;
      const a = s.answers[q.id];
      explainAnswers.push({ questionId: q.id, answer: a ? String(a.value) : '', points: q.points, keyPoints: q.keyPoints, prompt: q.prompt });
    } else {
      objectiveTotal += q.points;
      if (s.answers[q.id]?.correct) objectiveEarned += q.points;
    }
  }
  return { objectiveEarned, objectiveTotal, explainTotal, explainAnswers };
}

/** Reading score out of 25; explain points from AI (null = not assessed → scored on objective part only). */
export function readingScore(p: ReadingParts, explainEarned: number | null): { score: number; assessedFraction: number } {
  const total = p.objectiveTotal + (explainEarned === null ? 0 : p.explainTotal);
  const earned = p.objectiveEarned + (explainEarned ?? 0);
  if (total === 0) return { score: 0, assessedFraction: 0 };
  return { score: Math.round((RUBRIC.reading * earned) / total), assessedFraction: total / (p.objectiveTotal + p.explainTotal) };
}

export interface EvidenceBreakdown {
  keyFound: number;
  keyTotal: number;
  categorizedCorrect: number;
  categorizedTotal: number;
  distractorsCollected: number;
  linksCorrect: number;
  linksExpected: number;
  missedKeyEvidence: { id: string; label: string }[];
  score: number;
}

/** Evidence Collection out of 25: key recall 12 · categorization 8 · links 5. */
export function evidenceScore(d: CaseDossier, s: InvestigationState): EvidenceBreakdown {
  const key = d.evidence.filter((e) => e.key);
  const keyFound = key.filter((e) => s.collected[e.id]).length;
  const collectedIds = Object.keys(s.collected);
  let categorizedCorrect = 0;
  for (const id of collectedIds) {
    const ev = d.evidence.find((e) => e.id === id);
    if (ev && s.board[id]?.category === ev.category) categorizedCorrect++;
  }
  const distractorsCollected = collectedIds.filter((id) => d.evidence.find((e) => e.id === id)?.category === 'irrelevant').length;
  const canonical = new Set(d.links.map((l) => [l.a, l.b].sort().join('|')));
  const linksCorrect = s.links.filter((l) => canonical.has([l.a, l.b].sort().join('|'))).length;
  const wrongLinks = s.links.length - linksCorrect;
  const recall = key.length ? keyFound / key.length : 0;
  const categorization = collectedIds.length ? categorizedCorrect / collectedIds.length : 0;
  const linkScore = d.links.length ? Math.max(0, (linksCorrect - wrongLinks * 0.5) / d.links.length) : recall;
  const score = Math.round(12 * recall + 8 * categorization + 5 * Math.min(1, linkScore));
  return {
    keyFound,
    keyTotal: key.length,
    categorizedCorrect,
    categorizedTotal: collectedIds.length,
    distractorsCollected,
    linksCorrect,
    linksExpected: d.links.length,
    missedKeyEvidence: key.filter((e) => !s.collected[e.id]).map((e) => ({ id: e.id, label: e.label })),
    score: Math.min(RUBRIC.evidence, score),
  };
}

/** Machine part of Critical Thinking (out of 10): correct conclusion 6 + valid support 4. */
export function conclusionScore(d: CaseDossier, s: InvestigationState) {
  const c = s.conclusion;
  if (!c) return { score: 0, correct: false, requiredCited: 0, requiredTotal: d.conclusion.requiredEvidenceIds.length, weakSupport: [] as string[] };
  const correct = c.optionId === d.conclusion.correctOptionId;
  const requiredCited = d.conclusion.requiredEvidenceIds.filter((id) => c.supportingEvidenceIds.includes(id)).length;
  // Citing irrelevant or unverified evidence as support weakens the argument.
  const weakSupport = c.supportingEvidenceIds.filter((id) => {
    const cat = d.evidence.find((e) => e.id === id)?.category;
    return cat === 'irrelevant' || cat === 'unverified';
  });
  const supportRatio = requiredCited / d.conclusion.requiredEvidenceIds.length;
  const support = Math.max(0, 4 * supportRatio - weakSupport.length);
  return { score: Math.round((correct ? 6 : 0) + (correct ? support : 0)), correct, requiredCited, requiredTotal: d.conclusion.requiredEvidenceIds.length, weakSupport };
}

/* ---------------- game points (separate from language assessment) ---------------- */

export function gamePoints(d: CaseDossier, s: InvestigationState, solved: boolean) {
  const hints = Object.values(s.hintsUsed).reduce((a, b) => a + b, 0);
  const keyFound = d.evidence.filter((e) => e.key && s.collected[e.id]).length;
  const detectivePoints = Math.max(0, (solved ? 100 : 30) + keyFound * 10 + s.revealedFactIds.length * 5 - hints * 10);
  const xp = Math.round(d.xpReward * (solved ? 1 : 0.4));
  return { detectivePoints, xp, hintsUsed: hints };
}

export const ACHIEVEMENTS: Record<string, { en: string; vi: string }> = {
  first_case: { en: 'First case closed', vi: 'Phá vụ án đầu tiên' },
  sharp_eye: { en: 'Found every key clue', vi: 'Tìm đủ mọi manh mối then chốt' },
  no_hints: { en: 'Solved without hints', vi: 'Phá án không cần gợi ý' },
  interviewer: { en: 'Interviewed every witness', vi: 'Phỏng vấn mọi nhân chứng' },
  b2_detective: { en: 'Solved a B2 case', vi: 'Phá vụ án B2' },
  fine_writer: { en: 'Writing score 25/30+', vi: 'Điểm viết từ 25/30' },
  master_detective: { en: 'All cases solved', vi: 'Phá mọi vụ án' },
};

export function computeAchievements(
  allCaseIds: string[],
  d: CaseDossier,
  s: InvestigationState,
  solved: boolean,
  writingScore: number | null,
  completedCaseIds: string[],
  existing: string[],
): string[] {
  const earned = new Set<string>();
  const done = new Set(completedCaseIds);
  if (solved) done.add(d.id);
  if (solved) earned.add('first_case');
  if (d.evidence.filter((e) => e.key).every((e) => s.collected[e.id])) earned.add('sharp_eye');
  if (solved && Object.values(s.hintsUsed).every((n) => n === 0)) earned.add('no_hints');
  if (d.characters.every((c) => (s.interviewCounts[c.id] ?? 0) > 0)) earned.add('interviewer');
  if (solved && d.level === 'B2') earned.add('b2_detective');
  if (writingScore !== null && writingScore >= 25) earned.add('fine_writer');
  if (allCaseIds.length && allCaseIds.every((id) => done.has(id))) earned.add('master_detective');
  return [...earned].filter((a) => !existing.includes(a));
}

export function recommendNextCase(cases: { id: string; level: Level }[], current: CaseDossier, solved: boolean, percent: number, completed: string[]) {
  if (!solved || percent < 50) return { nextCaseId: current.id, nextLevel: current.level, reason: 'Replay this case: review the documents and the evidence you missed.' };
  const done = new Set([...completed, current.id]);
  const nextLevel: Level = current.level === 'B1' && percent >= 80 ? 'B2' : current.level;
  const pick = cases.find((c) => !done.has(c.id) && c.level === nextLevel) ?? cases.find((c) => !done.has(c.id));
  return pick
    ? { nextCaseId: pick.id, nextLevel, reason: nextLevel !== current.level ? `Strong result (${percent}%). Try a ${nextLevel} case.` : `Continue with another ${nextLevel} case.` }
    : { nextCaseId: null, nextLevel, reason: 'All cases solved – replay a case to improve your report.' };
}
