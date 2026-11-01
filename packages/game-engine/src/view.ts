/**
 * Student-safe projections of a dossier: never include answers, evidence categories,
 * character facts, conclusions or the sample solution.
 */
import type { CaseDossier, HintStage } from '@ed/shared';
import { availableQuestions, isDocumentUnlocked, stageProgress, submissionBlockers, type InvestigationState } from './state.js';

export function publicCaseSummary(d: CaseDossier) {
  return {
    id: d.id,
    level: d.level,
    title: d.title,
    summary: d.summary,
    role: d.role,
    setting: d.setting,
    topic: d.topic,
    estimatedMinutes: d.estimatedMinutes,
    xpReward: d.xpReward,
    documentCount: d.documents.length,
    characterCount: d.characters.length,
  };
}

export function publicCaseDetail(d: CaseDossier) {
  return {
    ...publicCaseSummary(d),
    briefing: d.briefing,
    objectives: d.objectives,
    characters: d.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, avatar: c.avatar })),
    writingTask: { type: d.writingTask.type, minWords: d.writingTask.minWords, maxWords: d.writingTask.maxWords },
    limits: d.limits,
  };
}

export interface SessionViewInput {
  dossier: CaseDossier;
  state: InvestigationState;
  submitted: boolean;
  limits: { interviewQuestionsPerCharacter: number; assistantRequests: number };
}

/** Everything the investigation workspace needs, restricted to unlocked content. */
export function investigationView({ dossier: d, state: s, submitted, limits }: SessionViewInput) {
  const progress = stageProgress(d, s, submitted);
  return {
    caseId: d.id,
    level: d.level,
    title: d.title,
    briefing: d.briefing,
    objectives: d.objectives,
    briefingAcknowledged: s.briefingAcknowledged,
    progress,
    documents: d.documents.map((doc) =>
      isDocumentUnlocked(d, s, doc.id)
        ? { id: doc.id, type: doc.type, title: doc.title, meta: doc.meta, body: doc.body, glossary: doc.glossary, locked: false, opened: s.openedDocumentIds.includes(doc.id) }
        : { id: doc.id, type: doc.type, title: 'Locked document', meta: {}, body: '', glossary: [], locked: true, opened: false },
    ),
    questions: availableQuestions(d, s).map((q) => {
      const a = s.answers[q.id];
      const base = { id: q.id, type: q.type, prompt: q.prompt, documentIds: q.documentIds, points: q.points, required: q.required };
      const extra =
        q.type === 'mcq'
          ? { options: q.options }
          : q.type === 'tfng'
            ? { statement: q.statement }
            : q.type === 'short'
              ? { maxWords: q.maxWords }
              : {};
      // After answering, show only right/wrong for objective questions (not the correct answer) until submission.
      return { ...base, ...extra, answer: a ? { value: a.value, correct: a.correct } : null };
    }),
    lockedQuestionCount: d.questions.length - availableQuestions(d, s).length,
    characters: d.characters.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      avatar: c.avatar,
      greeting: c.greeting,
      questionsUsed: s.interviewCounts[c.id] ?? 0,
      questionsMax: limits.interviewQuestionsPerCharacter,
    })),
    evidence: Object.entries(s.collected).map(([id, v]) => {
      const ev = d.evidence.find((e) => e.id === id)!;
      return { id, documentId: ev.documentId, label: ev.label, text: v.text, category: s.board[id]?.category ?? null, note: s.board[id]?.note ?? '' };
    }),
    clues: s.clues,
    links: s.links,
    conclusion: {
      question: d.conclusion.question,
      options: d.conclusion.options,
      minSupporting: d.conclusion.minSupporting,
      selected: s.conclusion,
    },
    writingTask: {
      type: d.writingTask.type,
      prompt: d.writingTask.prompt,
      audience: d.writingTask.audience,
      minWords: d.writingTask.minWords,
      maxWords: d.writingTask.maxWords,
      sections: d.writingTask.sections,
    },
    hints: Object.fromEntries((['documents', 'evidence', 'interviews', 'analysis', 'report'] as HintStage[]).map((k) => [k, { used: s.hintsUsed[k], max: 3, revealed: d.hints[k].slice(0, s.hintsUsed[k]) }])),
    assistant: { used: s.assistantCount, max: limits.assistantRequests },
    canSubmit: submissionBlockers(d, s).length === 0,
    submissionBlockers: submissionBlockers(d, s),
  };
}
export type InvestigationView = ReturnType<typeof investigationView>;
