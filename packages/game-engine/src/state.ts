/**
 * Investigation state and deterministic rules (the Game Engine).
 * The AI never changes this state directly: it can only *propose* revealed facts,
 * which are accepted here only if they belong to the character and their condition is met.
 */
import type { CaseDossier, EvidenceCategory, HintStage, Question, Unlock } from '@ed/shared';
import { containsPhrase, normalizeText, tokens } from './text.js';

export const STAGES = ['introduction', 'documents', 'evidence', 'interviews', 'analysis', 'report'] as const;
export type StageId = (typeof STAGES)[number];

export interface AnswerRecord {
  value: number | string;
  /** null = graded later by AI (explain questions). */
  correct: boolean | null;
  points: number;
  answeredAt: string;
}

export interface BoardItem {
  category: EvidenceCategory | null;
  note: string;
}

export interface InvestigationState {
  briefingAcknowledged: boolean;
  openedDocumentIds: string[];
  revealedFactIds: string[];
  answers: Record<string, AnswerRecord>;
  /** evidenceId → highlighted text */
  collected: Record<string, { text: string; at: string }>;
  /** Highlights that matched no evidence (kept as personal clues). */
  clues: { id: string; documentId: string; text: string; at: string }[];
  board: Record<string, BoardItem>;
  links: { a: string; b: string; note: string }[];
  conclusion: { optionId: string; supportingEvidenceIds: string[]; justification: string } | null;
  hintsUsed: Record<HintStage, number>;
  interviewCounts: Record<string, number>;
  assistantCount: number;
}

export function initialState(): InvestigationState {
  return {
    briefingAcknowledged: false,
    openedDocumentIds: [],
    revealedFactIds: [],
    answers: {},
    collected: {},
    clues: [],
    board: {},
    links: [],
    conclusion: null,
    hintsUsed: { documents: 0, evidence: 0, interviews: 0, analysis: 0, report: 0 },
    interviewCounts: {},
    assistantCount: 0,
  };
}

export class EngineError extends Error {
  constructor(
    readonly code: 'LOCKED' | 'NOT_FOUND' | 'VALIDATION' | 'NOT_READY_TO_SUBMIT' | 'HINT_LIMIT',
    message: string,
  ) {
    super(message);
  }
}

/* ---------------- unlocking ---------------- */

export function isUnlocked(u: Unlock, s: InvestigationState): boolean {
  switch (u.type) {
    case 'start':
      return true;
    case 'fact':
      return s.revealedFactIds.includes(u.factId);
    case 'question':
      return Boolean(s.answers[u.questionId]);
    case 'evidence':
      return Boolean(s.collected[u.evidenceId]);
  }
}

export function unlockedDocuments(d: CaseDossier, s: InvestigationState) {
  return d.documents.filter((doc) => isUnlocked(doc.unlock, s));
}

export function isDocumentUnlocked(d: CaseDossier, s: InvestigationState, documentId: string): boolean {
  const doc = d.documents.find((x) => x.id === documentId);
  return Boolean(doc && isUnlocked(doc.unlock, s));
}

/** Questions are available once all their documents are unlocked. */
export function availableQuestions(d: CaseDossier, s: InvestigationState): Question[] {
  return d.questions.filter((q) => q.documentIds.every((id) => isDocumentUnlocked(d, s, id)));
}

/** Facts a character may share right now (condition met). */
export function eligibleFacts(d: CaseDossier, s: InvestigationState, characterId: string) {
  const c = d.characters.find((x) => x.id === characterId);
  if (!c) throw new EngineError('NOT_FOUND', 'Unknown character');
  return c.facts.filter((f) => isUnlocked(f.condition, s));
}

/* ---------------- actions ---------------- */

const now = () => new Date().toISOString();

export function acknowledgeBriefing(s: InvestigationState): InvestigationState {
  return { ...s, briefingAcknowledged: true };
}

export function openDocument(d: CaseDossier, s: InvestigationState, documentId: string): InvestigationState {
  if (!isDocumentUnlocked(d, s, documentId)) throw new EngineError('LOCKED', 'This document is not available yet');
  if (s.openedDocumentIds.includes(documentId)) return s;
  return { ...s, openedDocumentIds: [...s.openedDocumentIds, documentId] };
}

export function checkObjectiveAnswer(q: Question, value: number | string): boolean | null {
  switch (q.type) {
    case 'mcq':
      return Number(value) === q.correctIndex;
    case 'tfng':
      return String(value).toLowerCase().replace(/[\s-]+/g, '_') === q.answer;
    case 'short': {
      const v = normalizeText(String(value));
      if (!v || tokens(String(value)).length > q.maxWords + 3) return false;
      return q.acceptable.some((a) => {
        const n = normalizeText(a);
        return v === n || ` ${v} `.includes(` ${n} `);
      });
    }
    case 'explain':
      return null;
  }
}

/** Answers a reading question. One attempt per question (prevents guessing by retrying). */
export function answerQuestion(d: CaseDossier, s: InvestigationState, questionId: string, value: number | string, at = now()) {
  const q = d.questions.find((x) => x.id === questionId);
  if (!q) throw new EngineError('NOT_FOUND', 'Unknown question');
  if (!availableQuestions(d, s).some((x) => x.id === q.id)) throw new EngineError('LOCKED', 'Read the related documents first');
  if (s.answers[q.id]) throw new EngineError('VALIDATION', 'This question has already been answered');
  if (q.type === 'mcq' && (typeof value !== 'number' || value < 0 || value >= q.options.length)) {
    throw new EngineError('VALIDATION', 'Choose one of the options');
  }
  if (q.type === 'tfng' && !['true', 'false', 'not_given'].includes(String(value).toLowerCase().replace(/[\s-]+/g, '_'))) {
    throw new EngineError('VALIDATION', 'Answer True, False or Not Given');
  }
  if ((q.type === 'short' || q.type === 'explain') && (typeof value !== 'string' || !value.trim())) {
    throw new EngineError('VALIDATION', 'Write an answer');
  }
  const correct = checkObjectiveAnswer(q, value);
  const rec: AnswerRecord = { value, correct, points: correct ? q.points : 0, answeredAt: at };
  return { state: { ...s, answers: { ...s.answers, [q.id]: rec } }, correct };
}

/**
 * Matches highlighted text against the evidence of an unlocked document.
 * - The highlight must really appear in the document.
 * - It matches evidence when it covers the excerpt (not much longer), or covers ≥ 60% of the excerpt's words.
 */
export function matchHighlight(d: CaseDossier, documentId: string, text: string): { evidenceId: string | null; inDocument: boolean } {
  const doc = d.documents.find((x) => x.id === documentId);
  if (!doc) return { evidenceId: null, inDocument: false };
  const sel = normalizeText(text);
  if (sel.length < 3) return { evidenceId: null, inDocument: false };
  const inDocument = ` ${normalizeText(doc.body)} `.includes(` ${sel} `) || normalizeText(doc.body).includes(sel);
  if (!inDocument) return { evidenceId: null, inDocument: false };
  const selTokens = sel.split(' ');
  let best: { id: string; score: number } | null = null;
  for (const ev of d.evidence.filter((e) => e.documentId === documentId)) {
    const ex = normalizeText(ev.excerpt);
    const exTokens = ex.split(' ');
    let score = 0;
    if (sel.includes(ex)) {
      // Selection covers the whole excerpt; reject selections that grab most of the document.
      if (selTokens.length <= Math.max(exTokens.length * 2.5, exTokens.length + 12)) score = 1;
    } else if (ex.includes(sel)) {
      score = selTokens.length / exTokens.length;
    } else {
      // Partial overlap at the edges: longest common run of tokens.
      score = longestCommonRun(selTokens, exTokens) / exTokens.length;
      if (selTokens.length > exTokens.length * 2.5) score = 0;
    }
    if (score >= 0.6 && (!best || score > best.score)) best = { id: ev.id, score };
  }
  return { evidenceId: best?.id ?? null, inDocument: true };
}

function longestCommonRun(a: string[], b: string[]): number {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let last = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last + 1 : 0;
      if (prev[j] > best) best = prev[j];
      last = tmp;
    }
  }
  return best;
}

export function collectHighlight(d: CaseDossier, s: InvestigationState, documentId: string, text: string, clueId: string, at = now()) {
  if (!isDocumentUnlocked(d, s, documentId)) throw new EngineError('LOCKED', 'This document is not available yet');
  const m = matchHighlight(d, documentId, text);
  if (!m.inDocument) throw new EngineError('VALIDATION', 'The highlighted text was not found in this document');
  const clean = text.trim().slice(0, 500);
  if (m.evidenceId) {
    if (s.collected[m.evidenceId]) return { state: s, evidenceId: m.evidenceId, isNew: false };
    return {
      state: {
        ...s,
        collected: { ...s.collected, [m.evidenceId]: { text: clean, at } },
        board: { ...s.board, [m.evidenceId]: { category: null, note: '' } },
      },
      evidenceId: m.evidenceId,
      isNew: true,
    };
  }
  if (s.clues.some((c) => normalizeText(c.text) === normalizeText(clean))) return { state: s, evidenceId: null, isNew: false };
  if (s.clues.length >= 50) throw new EngineError('VALIDATION', 'Too many personal clues');
  return { state: { ...s, clues: [...s.clues, { id: clueId, documentId, text: clean, at }] }, evidenceId: null, isNew: true };
}

export interface BoardUpdate {
  items: Record<string, { category: EvidenceCategory | null; note: string }>;
  links: { a: string; b: string; note: string }[];
}

export function updateBoard(s: InvestigationState, update: BoardUpdate): InvestigationState {
  const board: InvestigationState['board'] = { ...s.board };
  for (const [id, item] of Object.entries(update.items)) {
    if (!s.collected[id]) throw new EngineError('VALIDATION', `Evidence ${id} has not been collected`);
    board[id] = { category: item.category, note: item.note.slice(0, 600) };
  }
  const seen = new Set<string>();
  const links = [];
  for (const l of update.links) {
    if (l.a === l.b || !s.collected[l.a] || !s.collected[l.b]) throw new EngineError('VALIDATION', 'Links must connect two collected evidence items');
    const key = [l.a, l.b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ a: l.a, b: l.b, note: l.note.slice(0, 300) });
  }
  if (links.length > 40) throw new EngineError('VALIDATION', 'Too many links');
  return { ...s, board, links };
}

/** Accepts facts proposed by the AI only if they belong to the character and are eligible now. */
export function revealFacts(d: CaseDossier, s: InvestigationState, characterId: string, proposed: string[]) {
  const eligible = new Set(eligibleFacts(d, s, characterId).map((f) => f.id));
  const accepted = [...new Set(proposed)].filter((id) => eligible.has(id) && !s.revealedFactIds.includes(id));
  const rejected = proposed.filter((id) => !eligible.has(id));
  const before = new Set(unlockedDocuments(d, s).map((x) => x.id));
  const next = { ...s, revealedFactIds: [...s.revealedFactIds, ...accepted] };
  const newlyUnlockedDocumentIds = unlockedDocuments(d, next)
    .map((x) => x.id)
    .filter((id) => !before.has(id));
  return { state: next, accepted, rejected, newlyUnlockedDocumentIds };
}

export function countInterview(s: InvestigationState, characterId: string): InvestigationState {
  return { ...s, interviewCounts: { ...s.interviewCounts, [characterId]: (s.interviewCounts[characterId] ?? 0) + 1 } };
}

export function setConclusion(d: CaseDossier, s: InvestigationState, c: { optionId: string; supportingEvidenceIds: string[]; justification: string }) {
  if (!d.conclusion.options.some((o) => o.id === c.optionId)) throw new EngineError('VALIDATION', 'Unknown conclusion');
  const support = [...new Set(c.supportingEvidenceIds)];
  for (const id of support) if (!s.collected[id]) throw new EngineError('VALIDATION', 'Supporting evidence must be collected first');
  if (support.length < 1) throw new EngineError('VALIDATION', 'Select at least one piece of supporting evidence');
  return { ...s, conclusion: { optionId: c.optionId, supportingEvidenceIds: support, justification: c.justification.trim().slice(0, 1500) } };
}

export function nextHint(d: CaseDossier, s: InvestigationState, stage: HintStage) {
  const used = s.hintsUsed[stage];
  if (used >= 3) throw new EngineError('HINT_LIMIT', 'All three hints for this stage have been used');
  const hint = d.hints[stage][used]!;
  return { state: { ...s, hintsUsed: { ...s.hintsUsed, [stage]: used + 1 } }, hint, level: used + 1 };
}

/* ---------------- progress ---------------- */

export function stageProgress(d: CaseDossier, s: InvestigationState, submitted: boolean): Record<StageId, boolean> {
  const startDocs = d.documents.filter((x) => x.unlock.type === 'start').map((x) => x.id);
  const required = d.questions.filter((q) => q.required);
  const collectedCount = Object.keys(s.collected).length;
  const categorized = Object.keys(s.collected).every((id) => s.board[id]?.category);
  return {
    introduction: s.briefingAcknowledged,
    documents: startDocs.every((id) => s.openedDocumentIds.includes(id)) && required.filter((q) => availableQuestions(d, s).includes(q)).every((q) => s.answers[q.id]),
    evidence: collectedCount >= d.limits.minEvidenceToSubmit,
    interviews: d.characters.every((c) => (s.interviewCounts[c.id] ?? 0) > 0),
    analysis: collectedCount > 0 && categorized && Boolean(s.conclusion),
    report: submitted,
  };
}

export function submissionBlockers(d: CaseDossier, s: InvestigationState): string[] {
  const out: string[] = [];
  const missing = d.questions.filter((q) => q.required && !s.answers[q.id]);
  if (missing.length) out.push(`Answer the remaining required reading questions (${missing.length}).`);
  const n = Object.keys(s.collected).length;
  if (n < d.limits.minEvidenceToSubmit) out.push(`Collect at least ${d.limits.minEvidenceToSubmit} pieces of evidence (you have ${n}).`);
  if (!s.conclusion) out.push('Choose a conclusion on the Case Board.');
  else if (s.conclusion.supportingEvidenceIds.length < d.conclusion.minSupporting) {
    out.push(`Support your conclusion with at least ${d.conclusion.minSupporting} pieces of evidence.`);
  }
  return out;
}

/**
 * Offline fact selection (development/tests only): eligible facts whose keywords appear in the question.
 * The real Character Engine lets Gemini choose, but the engine validates its choice the same way.
 */
export function keywordFacts(d: CaseDossier, s: InvestigationState, characterId: string, question: string): string[] {
  return eligibleFacts(d, s, characterId)
    .filter((f) => f.keywords.some((k) => containsPhrase(question, k)))
    .map((f) => f.id);
}
