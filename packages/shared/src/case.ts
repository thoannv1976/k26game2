/**
 * Canonical Case Dossier – the approved, versioned source of truth for one investigation.
 * Only the backend reads the full dossier; students receive the parts they have unlocked.
 */
import { z } from 'zod';
import { I18nTextSchema, LevelSchema } from './platform.js';

const Id = z.string().regex(/^[a-z0-9_]+$/, 'ids are lower_snake_case');

/* ---------------- unlocking ---------------- */

export const UnlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  /** Unlocked when a character reveals this fact. */
  z.object({ type: z.literal('fact'), factId: Id }),
  /** Unlocked when this question has been answered (right or wrong). */
  z.object({ type: z.literal('question'), questionId: Id }),
  /** Unlocked when this evidence has been collected. */
  z.object({ type: z.literal('evidence'), evidenceId: Id }),
]);
export type Unlock = z.infer<typeof UnlockSchema>;

/* ---------------- documents ---------------- */

export const DOCUMENT_TYPES = ['email', 'notice', 'webpage', 'letter', 'report', 'chat', 'contract', 'table', 'news', 'receipt', 'memo', 'form', 'review'] as const;

export const CaseDocumentSchema = z.object({
  id: Id,
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().min(3).max(140),
  /** Header fields shown above the body, e.g. {From, To, Date, Subject} or {URL}. */
  meta: z.record(z.string(), z.string()).default({}),
  /** Plain text. Paragraphs separated by a blank line. Tables: Markdown pipe rows. */
  body: z.string().min(40).max(6000),
  unlock: UnlockSchema.default({ type: 'start' }),
  glossary: z
    .array(z.object({ term: z.string().min(1), definition: z.string().min(3), vi: z.string().min(1) }))
    .max(15)
    .default([]),
});
export type CaseDocument = z.infer<typeof CaseDocumentSchema>;

/* ---------------- reading questions ---------------- */

const QuestionBase = {
  id: Id,
  documentIds: z.array(Id).min(1),
  prompt: z.string().min(8).max(400),
  points: z.number().int().min(1).max(5),
  required: z.boolean().default(true),
};

export const QuestionSchema = z.discriminatedUnion('type', [
  z.object({ ...QuestionBase, type: z.literal('mcq'), options: z.array(z.string().min(1)).min(2).max(6), correctIndex: z.number().int().min(0) }),
  z.object({ ...QuestionBase, type: z.literal('tfng'), statement: z.string().min(5), answer: z.enum(['true', 'false', 'not_given']) }),
  /** Short answer: correct if the normalized answer equals or contains one of `acceptable`. */
  z.object({ ...QuestionBase, type: z.literal('short'), acceptable: z.array(z.string().min(1)).min(1), maxWords: z.number().int().min(1).max(15) }),
  /** Open explanation graded by AI against key points. */
  z.object({ ...QuestionBase, type: z.literal('explain'), keyPoints: z.array(z.string().min(3)).min(1).max(6), sampleAnswer: z.string().min(10) }),
]);
export type Question = z.infer<typeof QuestionSchema>;

/* ---------------- evidence ---------------- */

export const EVIDENCE_CATEGORIES = ['verified', 'unverified', 'irrelevant'] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const EvidenceSchema = z.object({
  id: Id,
  documentId: Id,
  /** Exact text from the document body (the student must highlight it). 3–40 words. */
  excerpt: z.string().min(8).max(400),
  /** Short label shown on the evidence card after collection. */
  label: z.string().min(3).max(120),
  category: z.enum(EVIDENCE_CATEGORIES),
  /** Key evidence needed to solve the case. Distractors are never key. */
  key: z.boolean(),
  /** Why it matters (teacher-facing, also given to the critical-thinking grader). */
  explanation: z.string().min(10).max(500),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/* ---------------- characters ---------------- */

export const AVATARS = ['student_f', 'student_m', 'officer_f', 'officer_m', 'it_f', 'it_m', 'manager_f', 'manager_m', 'clerk_f', 'clerk_m', 'expert_f', 'expert_m', 'journalist_f', 'journalist_m'] as const;

export const CharacterFactSchema = z.object({
  /** Unique across the whole case. */
  id: Id,
  /** What the character knows (English). The AI may only state these facts. */
  text: z.string().min(10).max(400),
  /** When the character is allowed to share it (default: from the start). */
  condition: UnlockSchema.default({ type: 'start' }),
  /** Topics/words in a question that make this fact relevant (hint for the AI; used by the offline provider). */
  keywords: z.array(z.string().min(2)).min(1).max(10),
  /** Revealing this fact unlocks a document. */
  unlocksDocumentId: Id.optional(),
});
export type CharacterFact = z.infer<typeof CharacterFactSchema>;

export const CharacterSchema = z.object({
  id: Id,
  name: z.string().min(2).max(60),
  role: z.string().min(2).max(120),
  avatar: z.enum(AVATARS),
  personality: z.string().min(10).max(300),
  background: z.string().min(10).max(600),
  greeting: z.string().min(5).max(300),
  facts: z.array(CharacterFactSchema).min(2).max(12),
  /** Information the character must never reveal (e.g. the conclusion, other people's private data). */
  restricted: z
    .array(z.object({ topic: z.string().min(3), forbiddenPhrases: z.array(z.string().min(3)).min(1) }))
    .default([]),
});
export type Character = z.infer<typeof CharacterSchema>;

/* ---------------- analysis & writing ---------------- */

export const ConclusionSchema = z.object({
  question: z.string().min(10),
  options: z.array(z.object({ id: Id, text: z.string().min(5).max(300) })).min(2).max(5),
  correctOptionId: Id,
  /** Evidence that must support the correct conclusion. */
  requiredEvidenceIds: z.array(Id).min(1),
  minSupporting: z.number().int().min(1).max(8),
  /** Claims that sound plausible but are NOT supported by the evidence. */
  unsupportedClaims: z.array(z.string().min(5)).min(1),
});

export const WritingRubricSchema = z.object({
  taskAchievement: z.literal(10),
  coherence: z.literal(7),
  vocabulary: z.literal(7),
  grammar: z.literal(6),
});

export const WritingTaskSchema = z.object({
  type: z.enum(['report', 'email', 'memo']),
  prompt: z.string().min(20).max(800),
  audience: z.string().min(3),
  minWords: z.number().int().min(80).max(300),
  maxWords: z.number().int().min(120).max(400),
  sections: z.array(z.string().min(3)).min(2).max(6),
  /** Ideas a strong answer includes (for the grader, hidden from students). */
  keyPoints: z.array(z.string().min(5)).min(3).max(8),
  rubric: WritingRubricSchema.default({ taskAchievement: 10, coherence: 7, vocabulary: 7, grammar: 6 }),
});

export const HINT_STAGES = ['documents', 'evidence', 'interviews', 'analysis', 'report'] as const;
export type HintStage = (typeof HINT_STAGES)[number];
const ThreeHints = z.tuple([z.string().min(5), z.string().min(5), z.string().min(5)]);

export const CaseLimitsSchema = z.object({
  interviewQuestionsPerCharacter: z.number().int().min(2).max(40),
  assistantRequests: z.number().int().min(0).max(50),
  minEvidenceToSubmit: z.number().int().min(1).max(20),
  timeMinutes: z.number().int().min(10).max(120),
});

/* ---------------- sample solution (tests, teacher reference, offline AI) ---------------- */

export const SampleSolutionSchema = z.object({
  /** Text the student would highlight (each must match one evidence item). */
  highlights: z.array(z.object({ documentId: Id, text: z.string().min(5), evidenceId: Id })).min(1),
  /** questionId → answer: mcq index (number), tfng value, short text, explain text. */
  answers: z.record(z.string(), z.union([z.number(), z.string()])),
  interviewQuestions: z.array(z.object({ characterId: Id, question: z.string().min(5), expectFactIds: z.array(Id) })).min(1),
  links: z.array(z.object({ a: Id, b: Id })).default([]),
  conclusion: z.object({ optionId: Id, supportingEvidenceIds: z.array(Id).min(1), justification: z.string().min(20) }),
  report: z.string().min(200),
});

/* ---------------- the dossier ---------------- */

export const CaseDossierSchema = z.object({
  id: z.string().regex(/^CASE\d{2,3}$/),
  level: LevelSchema,
  title: I18nTextSchema,
  summary: I18nTextSchema,
  role: z.string().min(3),
  setting: z.string().min(3),
  topic: z.string().min(3),
  estimatedMinutes: z.number().int().min(10).max(60),
  xpReward: z.number().int().min(50).max(500),
  briefing: I18nTextSchema,
  objectives: z.array(I18nTextSchema).min(2).max(6),
  documents: z.array(CaseDocumentSchema).min(3).max(10),
  questions: z.array(QuestionSchema).min(4).max(12),
  evidence: z.array(EvidenceSchema).min(5).max(20),
  /** Canonical links between evidence (pairs that belong together). */
  links: z.array(z.object({ a: Id, b: Id, relation: z.string().min(3) })).default([]),
  characters: z.array(CharacterSchema).min(2).max(4),
  conclusion: ConclusionSchema,
  writingTask: WritingTaskSchema,
  hints: z.object({
    documents: ThreeHints,
    evidence: ThreeHints,
    interviews: ThreeHints,
    analysis: ThreeHints,
    report: ThreeHints,
  }),
  limits: CaseLimitsSchema,
  sampleSolution: SampleSolutionSchema,
});
export type CaseDossier = z.infer<typeof CaseDossierSchema>;

/* ---------------- Firestore docs ---------------- */

export const CASE_STATUSES = ['draft', 'approved', 'archived'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** tenants/{t}/cases/{id} */
export interface CaseDoc {
  id: string;
  level: 'B1' | 'B2';
  approvedVersion: number;
  latestVersion: number;
  status: CaseStatus;
  title: { en: string; vi: string } | null;
  updatedAt: string;
}

/** tenants/{t}/cases/{id}/versions/{n} */
export interface CaseVersionDoc {
  version: number;
  dossier: CaseDossier;
  status: 'draft' | 'approved' | 'superseded';
  source: 'builtin' | 'teacher' | 'ai_generated';
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string;
}
