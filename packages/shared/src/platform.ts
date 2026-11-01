/**
 * Platform types shared with English City Simulator (Game 1): schools (tenants), users, roles,
 * courses, assignments, AI configuration and cost quotas. Accounts are shared through Firebase Auth
 * custom claims {tenantId, role}; each game keeps its own Firestore database.
 */
import { z } from 'zod';

export const LEVELS = ['B1', 'B2'] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

export const ROLES = ['student', 'teacher', 'school_admin', 'platform_admin'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** Text shown in the UI in both languages. */
export const I18nTextSchema = z.object({
  en: z.string().min(1),
  vi: z.string().min(1),
});
export type I18nText = z.infer<typeof I18nTextSchema>;

/* ------------------------------------------------------------------ */
/* Quotas & AI configuration                                           */
/* ------------------------------------------------------------------ */

export const QuotaConfigSchema = z.object({
  aiCallsPerStudentPerDay: z.number().int().min(0).max(5000),
  attemptsPerCasePerDay: z.number().int().min(1).max(100),
  /** Overrides the case limits when lower. */
  interviewQuestionsPerSession: z.number().int().min(0).max(500),
  assistantRequestsPerSession: z.number().int().min(0).max(200),
  gradingRequestsPerSession: z.number().int().min(1).max(10),
  maxSessionMinutes: z.number().int().min(10).max(240),
  maxOutputTokens: z.number().int().min(256).max(8192),
  monthlyBudgetUsd: z.number().min(0).max(100000),
  warnRatio: z.number().min(0.1).max(1),
  onBudgetExceeded: z.enum(['block', 'warn_only']),
});
export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;
export const DEFAULT_QUOTAS: QuotaConfig = {
  aiCallsPerStudentPerDay: 150,
  attemptsPerCasePerDay: 5,
  interviewQuestionsPerSession: 40,
  assistantRequestsPerSession: 15,
  gradingRequestsPerSession: 2,
  maxSessionMinutes: 90,
  maxOutputTokens: 2048,
  monthlyBudgetUsd: 60,
  warnRatio: 0.8,
  onBudgetExceeded: 'block',
};

export const PricingSchema = z.object({
  inputTokensPer1M: z.number().min(0),
  outputTokensPer1M: z.number().min(0),
});
export type Pricing = z.infer<typeof PricingSchema>;

export const AiConfigSchema = z.object({
  /** Model for characters and the assistant. */
  model: z.string().min(3),
  /** Model for grading and the case generator. */
  assessmentModel: z.string().min(3),
  temperature: z.number().min(0).max(1.5),
  historyTurns: z.number().int().min(2).max(40),
  pricing: PricingSchema,
});
export type AiConfig = z.infer<typeof AiConfigSchema>;
export const DEFAULT_AI_CONFIG: AiConfig = {
  // Verified on project k26game1 when Game 1 was deployed (gemini-2.5-flash returned 404 there).
  model: 'gemini-3-flash-preview',
  assessmentModel: 'gemini-3-flash-preview',
  temperature: 0.6,
  historyTurns: 12,
  // Reference prices (USD) – review against the current Google Cloud price list.
  pricing: { inputTokensPer1M: 0.5, outputTokensPer1M: 3 },
};

/* ------------------------------------------------------------------ */
/* Tenants, users, courses                                             */
/* ------------------------------------------------------------------ */

export interface TenantDoc {
  id: string;
  name: string;
  allowedEmailDomains: string[];
  quotas: QuotaConfig;
  aiConfig: AiConfig;
  active: boolean;
  createdAt: string;
}

export interface UserDoc {
  uid: string;
  tenantId: string;
  role: Role;
  email: string;
  displayName: string;
  studentCode?: string;
  courseIds: string[];
  level: Level;
  /** Game points (separate from English assessment scores). */
  xp: number;
  detectivePoints: number;
  completedCaseIds: string[];
  /** Best final percentage per case id. */
  bestPercent: Record<string, number>;
  achievements: string[];
  locale: 'vi' | 'en';
  disabled: boolean;
  createdAt: string;
}

export interface CourseDoc {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  teacherIds: string[];
  studentIds: string[];
  /** Optional monthly AI budget for this course (USD). */
  monthlyBudgetUsd: number | null;
  createdAt: string;
}

export interface AssignmentDoc {
  id: string;
  courseId: string;
  caseId: string;
  dueAt: string | null;
  note: string;
  createdBy: string;
  createdAt: string;
}

export const ApiErrorCodes = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_PROVISIONED',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'REQUEST_IN_PROGRESS',
  'SESSION_NOT_ACTIVE',
  'LOCKED',
  'NOT_READY_TO_SUBMIT',
  'DRAFT_CONFLICT',
  'INTERVIEW_LIMIT',
  'ASSISTANT_LIMIT',
  'HINT_LIMIT',
  'GRADING_LIMIT',
  'TIME_LIMIT',
  'QUOTA_EXCEEDED',
  'BUDGET_EXCEEDED',
  'ATTEMPT_LIMIT',
  'CONTENT_BLOCKED',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof ApiErrorCodes)[number];
