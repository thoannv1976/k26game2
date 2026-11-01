import type { InvestigationState, EvidenceBreakdown } from '@ed/game-engine';
import type { Level } from '@ed/shared';

export const SESSION_STATUSES = ['active', 'submitted', 'grading', 'graded', 'grading_failed', 'abandoned'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** tenants/{t}/investigation_sessions/{sid} */
export interface SessionDoc {
  id: string;
  tenantId: string;
  uid: string;
  caseId: string;
  caseVersion: number;
  level: Level;
  courseId: string | null;
  assignmentId: string | null;
  status: SessionStatus;
  state: InvestigationState;
  startedAt: string;
  lastActivityAt: string;
  submittedAt: string | null;
  gradedAt: string | null;
  /** Concurrency guard for AI requests (interview/assistant) and grading. */
  lockId: string | null;
  lockSince: string | null;
  gradingAttempts: number;
  /** Total AI interview questions in this session. */
  interviewTotal: number;
}

/** tenants/{t}/investigation_sessions/{sid}/interview_messages/{clientMessageId} */
export interface InterviewMessageDoc {
  id: string;
  characterId: string;
  question: string;
  reply: string;
  factsRevealed: string[];
  unlockedDocumentIds: string[];
  fallback: boolean;
  blocked: string | null;
  createdAt: string;
  status: 'processing' | 'done' | 'failed';
}

export interface AssistantMessageDoc {
  id: string;
  stage: string;
  question: string;
  answer: string;
  kind: string;
  createdAt: string;
  status: 'processing' | 'done' | 'failed';
}

export interface DraftDoc {
  text: string;
  version: number;
  wordCount: number;
  updatedAt: string;
}

export interface NotebookDoc {
  text: string;
  updatedAt: string;
}

/** tenants/{t}/final_reports/{sid} */
export interface FinalReportDoc {
  sessionId: string;
  uid: string;
  caseId: string;
  text: string;
  wordCount: number;
  draftVersion: number;
  submittedAt: string;
}

export type CriterionKey = 'reading' | 'evidence' | 'criticalThinking' | 'writing';
export const CRITERION_KEYS: CriterionKey[] = ['reading', 'evidence', 'criticalThinking', 'writing'];

export interface CriterionResult {
  max: number;
  /** Part of `max` that was actually assessed (e.g. 10 of 20 when only the machine part is available). */
  assessedMax: number;
  score: number | null;
  status: 'assessed' | 'partial' | 'not_assessed';
  source: 'engine' | 'ai' | 'engine+ai' | 'teacher';
  comment: string;
}

export interface TeacherReview {
  reviewerUid: string;
  reviewerName: string;
  scores: Partial<Record<CriterionKey, number>>;
  comment: string;
  status: 'confirmed' | 'adjusted';
  reviewedAt: string;
}

/** tenants/{t}/assessments/{sid} */
export interface AssessmentDoc {
  id: string;
  tenantId: string;
  uid: string;
  sessionId: string;
  caseId: string;
  caseVersion: number;
  level: Level;
  courseId: string | null;
  solved: boolean;
  criteria: Record<CriterionKey, CriterionResult>;
  writingParts: Record<'taskAchievement' | 'coherence' | 'vocabulary' | 'grammar', { score: number; max: number; comment: string }> | null;
  evidence: EvidenceBreakdown;
  conclusion: { correct: boolean; requiredCited: number; requiredTotal: number; weakSupport: string[]; correctText: string; chosenText: string | null };
  readingDetail: { objectiveEarned: number; objectiveTotal: number; explain: { questionId: string; score: number; max: number; comment: string }[] | null };
  total: number;
  maxAssessed: number;
  percent: number;
  finalPercent: number;
  aiStatus: 'ok' | 'failed' | 'skipped';
  feedback: {
    strengths: string[];
    improvements: string[];
    examples: { quote: string; comment: string }[];
    corrections: { original: string; corrected: string; explanation: string }[];
    reasoningComment: string;
    unsupportedClaimsUsed: string[];
    recommendations: { vocabulary: string[]; grammar: string[]; readingSkills: string[]; reasoningSkills: string[]; nextWritingTask: string };
  } | null;
  wordCount: number;
  recommendation: { nextCaseId: string | null; nextLevel: Level; reason: string };
  gamePoints: { detectivePoints: number; xp: number; hintsUsed: number };
  newAchievements: string[];
  versions: { rubric: string; prompt: string; model: string; caseVersion: number };
  qualityChecks: { removedUnverifiableQuotes: number };
  teacherReview: TeacherReview | null;
  disclaimer: string;
  createdAt: string;
}
