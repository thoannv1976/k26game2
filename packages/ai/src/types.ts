import { z } from 'zod';
import type { CaseDossier, Level } from '@ed/shared';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/* ---------------- Character Engine ---------------- */

export interface CharacterInput {
  dossier: CaseDossier;
  characterId: string;
  /** Facts the character may share now (eligible by the Game Engine). */
  eligibleFacts: { id: string; text: string }[];
  alreadyRevealedFactIds: string[];
  history: { question: string; reply: string }[];
  question: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}
export const CharacterOutputSchema = z.object({
  reply: z.string().min(1).max(900),
  factsRevealed: z.array(z.string()).max(6).default([]),
  outOfScope: z.boolean().default(false),
  inappropriate: z.boolean().default(false),
});
export type CharacterOutput = z.infer<typeof CharacterOutputSchema>;

/* ---------------- Investigation Assistant ---------------- */

export interface AssistantInput {
  dossier: CaseDossier;
  unlockedDocuments: { id: string; title: string; body: string }[];
  stage: string;
  question: string;
  level: Level;
  model: string;
  maxOutputTokens: number;
}
export const ASSISTANT_KINDS = ['vocabulary', 'grammar', 'reading_strategy', 'investigation_tip', 'writing_tip', 'refused'] as const;
export const AssistantOutputSchema = z.object({
  answer: z.string().min(1).max(1200),
  kind: z.enum(ASSISTANT_KINDS),
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

/* ---------------- Grader (explain answers + reasoning + writing) ---------------- */

export interface GradeInput {
  dossier: CaseDossier;
  explainAnswers: { questionId: string; prompt: string; answer: string; points: number; keyPoints: string[] }[];
  collectedEvidence: { id: string; label: string; studentCategory: string | null; studentNote: string; canonicalCategory: string; explanation: string }[];
  conclusion: { optionText: string; isCorrect: boolean; justification: string; supportingLabels: string[] } | null;
  report: string;
  wordCount: number;
  model: string;
  maxOutputTokens: number;
}
const Scored = z.object({ score: z.number().min(0), comment: z.string().max(800) });
export const GradeOutputSchema = z.object({
  explainAnswers: z.array(z.object({ questionId: z.string(), score: z.number().min(0), comment: z.string().max(500) })).max(12).default([]),
  reasoning: z.object({ score: z.number().min(0), comment: z.string().max(800), unsupportedClaimsUsed: z.array(z.string().max(300)).max(6).default([]) }),
  writing: z.object({ taskAchievement: Scored, coherence: Scored, vocabulary: Scored, grammar: Scored }),
  examples: z.array(z.object({ quote: z.string().max(400), comment: z.string().max(400) })).max(8).default([]),
  corrections: z.array(z.object({ original: z.string().max(400), corrected: z.string().max(400), explanation: z.string().max(400) })).max(10).default([]),
  strengths: z.array(z.string().max(300)).max(6).default([]),
  improvements: z.array(z.string().max(300)).max(6).default([]),
  recommendations: z.object({
    vocabulary: z.array(z.string().max(200)).max(8).default([]),
    grammar: z.array(z.string().max(200)).max(6).default([]),
    readingSkills: z.array(z.string().max(300)).max(4).default([]),
    reasoningSkills: z.array(z.string().max(300)).max(4).default([]),
    nextWritingTask: z.string().max(400).default(''),
  }),
});
export type GradeOutput = z.infer<typeof GradeOutputSchema>;

/* ---------------- Case Generator ---------------- */

export const CaseRequestSchema = z.object({
  topic: z.string().trim().min(3).max(200),
  level: z.enum(['B1', 'B2']),
  learningObjectives: z.string().trim().min(5).max(800),
  documentCount: z.number().int().min(4).max(8),
  characterCount: z.number().int().min(2).max(4),
  minutes: z.number().int().min(15).max(60),
  writingType: z.enum(['report', 'email', 'memo']),
  caseId: z.string().regex(/^CASE\d{2,3}$/),
});
export type CaseRequest = z.infer<typeof CaseRequestSchema>;

export interface AiProvider {
  readonly name: string;
  character(input: CharacterInput): Promise<{ output: CharacterOutput; usage: Usage }>;
  assistant(input: AssistantInput): Promise<{ output: AssistantOutput; usage: Usage }>;
  grade(input: GradeInput): Promise<{ output: GradeOutput; usage: Usage }>;
  /** Returns raw JSON (validated by the caller with checkDossier). */
  generateCase(request: CaseRequest, example: CaseDossier, model: string, feedback?: string[]): Promise<{ output: unknown; usage: Usage }>;
  ping(model: string): Promise<string>;
}
