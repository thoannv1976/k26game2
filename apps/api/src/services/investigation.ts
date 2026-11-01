import { randomUUID } from 'node:crypto';
import {
  EngineError,
  acknowledgeBriefing,
  answerQuestion,
  collectHighlight,
  countInterview,
  eligibleFacts,
  initialState,
  investigationView,
  nextHint,
  openDocument,
  revealFacts,
  setConclusion,
  submissionBlockers,
  unlockedDocuments,
  updateBoard,
  wordCount,
  type BoardUpdate,
  type InvestigationState,
} from '@ed/game-engine';
import { guardAssistantAnswer, guardCharacterReply, CHARACTER_FALLBACK, isInappropriate } from '@ed/ai';
import type { AssignmentDoc, CaseDossier, CourseDoc, HintStage, TenantDoc } from '@ed/shared';
import type { Member } from '../auth.js';
import type { Deps } from '../deps.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { paths } from '../paths.js';
import { recordUsage, reserveAiCall, reserveAttempt } from '../quota.js';
import { getApprovedCase, getCaseVersion, getTenant } from '../tenants.js';
import type { AssistantMessageDoc, DraftDoc, InterviewMessageDoc, NotebookDoc, SessionDoc } from '../types.js';
import { canViewStudent } from './access.js';
import { withRetry } from './retry.js';

const LOCK_STALE_MS = 90_000;

function engineToApi(e: unknown): never {
  if (e instanceof EngineError) throw new ApiError(e.code, e.message);
  throw e;
}

export function sessionLimits(d: CaseDossier, t: TenantDoc) {
  return {
    interviewQuestionsPerCharacter: d.limits.interviewQuestionsPerCharacter,
    interviewQuestionsPerSession: t.quotas.interviewQuestionsPerSession,
    assistantRequests: Math.min(d.limits.assistantRequests, t.quotas.assistantRequestsPerSession),
  };
}

async function loadSession(deps: Deps, m: Member, sessionId: string): Promise<SessionDoc> {
  const s = (await paths(deps.db).session(m.tenantId, sessionId).get()).data() as SessionDoc | undefined;
  if (!s) throw notFound('Investigation');
  return s;
}

async function loadOwnSession(deps: Deps, m: Member, sessionId: string): Promise<SessionDoc> {
  const s = await loadSession(deps, m, sessionId);
  if (s.uid !== m.uid) throw forbidden('This is not your investigation');
  return s;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export async function buildView(deps: Deps, tenantId: string, s: SessionDoc, d?: CaseDossier, t?: TenantDoc) {
  const p = paths(deps.db);
  const tenant = t ?? (await getTenant(deps, tenantId));
  const dossier = d ?? (await getCaseVersion(deps, tenantId, s.caseId, s.caseVersion));
  const limits = sessionLimits(dossier, tenant);
  const [msgs, assist, notebook, draft] = await Promise.all([
    p.messages(tenantId, s.id).orderBy('createdAt').get(),
    p.assistantMessages(tenantId, s.id).orderBy('createdAt').get(),
    p.notebook(tenantId, s.id).get(),
    p.draft(tenantId, s.id).get(),
  ]);
  return {
    session: {
      id: s.id,
      caseId: s.caseId,
      caseVersion: s.caseVersion,
      status: s.status,
      startedAt: s.startedAt,
      submittedAt: s.submittedAt,
      interviewTotal: s.interviewTotal,
      interviewMax: limits.interviewQuestionsPerSession,
      timeMinutes: dossier.limits.timeMinutes,
    },
    investigation: investigationView({ dossier, state: s.state, submitted: s.status !== 'active', limits }),
    interviews: msgs.docs
      .map((x) => x.data() as InterviewMessageDoc)
      .filter((x) => x.status === 'done')
      .map((x) => ({ id: x.id, characterId: x.characterId, question: x.question, reply: x.reply, unlockedDocumentIds: x.unlockedDocumentIds, createdAt: x.createdAt })),
    assistant: assist.docs
      .map((x) => x.data() as AssistantMessageDoc)
      .filter((x) => x.status === 'done')
      .map((x) => ({ id: x.id, stage: x.stage, question: x.question, answer: x.answer, kind: x.kind, createdAt: x.createdAt })),
    notebook: (notebook.data() as NotebookDoc | undefined) ?? { text: '', updatedAt: null },
    draft: (draft.data() as DraftDoc | undefined) ?? { text: '', version: 0, wordCount: 0, updatedAt: null },
  };
}

/* ------------------------------------------------------------------ */
/* Start / resume                                                      */
/* ------------------------------------------------------------------ */

export async function startInvestigation(deps: Deps, m: Member, input: { caseId: string; assignmentId?: string; restart?: boolean }) {
  const p = paths(deps.db);
  const tenant = await getTenant(deps, m.tenantId);
  const { dossier, version } = await getApprovedCase(deps, m.tenantId, input.caseId);
  const existing = await p.sessions(m.tenantId).where('uid', '==', m.uid).where('caseId', '==', dossier.id).where('status', '==', 'active').limit(5).get();
  if (!existing.empty && !input.restart) {
    const s = existing.docs[0]!.data() as SessionDoc;
    return { resumed: true, ...(await buildView(deps, m.tenantId, s, undefined, tenant)) };
  }
  let courseId: string | null = null;
  let assignmentId: string | null = null;
  if (input.assignmentId) {
    const a = (await p.assignments(m.tenantId).doc(input.assignmentId).get()).data() as AssignmentDoc | undefined;
    if (!a || a.caseId !== dossier.id) throw notFound('Assignment');
    const c = (await p.course(m.tenantId, a.courseId).get()).data() as CourseDoc | undefined;
    if (!c || !c.studentIds.includes(m.uid)) throw forbidden('You are not in this course');
    courseId = a.courseId;
    assignmentId = a.id;
  }
  const now = deps.now().toISOString();
  const s: SessionDoc = {
    id: randomUUID(),
    tenantId: m.tenantId,
    uid: m.uid,
    caseId: dossier.id,
    caseVersion: version,
    level: dossier.level,
    courseId,
    assignmentId,
    status: 'active',
    state: initialState(),
    startedAt: now,
    lastActivityAt: now,
    submittedAt: null,
    gradedAt: null,
    lockId: null,
    lockSince: null,
    gradingAttempts: 0,
    interviewTotal: 0,
  };
  await deps.db.runTransaction(async (tx) => {
    const commit = await reserveAttempt(deps, tx, tenant, m.uid, dossier.id);
    for (const d of existing.docs) tx.update(d.ref, { status: 'abandoned', lastActivityAt: now });
    commit();
    tx.create(p.session(m.tenantId, s.id), s);
  });
  return { resumed: false, ...(await buildView(deps, m.tenantId, s, dossier, tenant)) };
}

export async function getInvestigation(deps: Deps, m: Member, sessionId: string) {
  const s = await loadSession(deps, m, sessionId);
  if (s.uid !== m.uid && !(await canViewStudent(deps, m, s.uid))) throw forbidden();
  return buildView(deps, m.tenantId, s);
}

/* ------------------------------------------------------------------ */
/* Deterministic actions (one transaction each)                        */
/* ------------------------------------------------------------------ */

async function mutate<T>(
  deps: Deps,
  m: Member,
  sessionId: string,
  fn: (d: CaseDossier, st: InvestigationState, s: SessionDoc) => { state: InvestigationState; result?: T },
): Promise<{ result: T | undefined; view: Awaited<ReturnType<typeof buildView>> }> {
  const p = paths(deps.db);
  const s0 = await loadOwnSession(deps, m, sessionId);
  const d = await getCaseVersion(deps, m.tenantId, s0.caseId, s0.caseVersion);
  const ref = p.session(m.tenantId, sessionId);
  let result: T | undefined;
  const next = await deps.db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data() as SessionDoc;
    if (s.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', 'This investigation has already been submitted');
    let out;
    try {
      out = fn(d, s.state, s);
    } catch (e) {
      engineToApi(e);
    }
    result = out.result;
    const updated: SessionDoc = { ...s, state: out.state, lastActivityAt: deps.now().toISOString() };
    tx.set(ref, updated);
    return updated;
  });
  return { result, view: await buildView(deps, m.tenantId, next, d) };
}

export const acknowledge = (deps: Deps, m: Member, sid: string) => mutate(deps, m, sid, (_d, st) => ({ state: acknowledgeBriefing(st) }));

export const openDoc = (deps: Deps, m: Member, sid: string, documentId: string) =>
  mutate(deps, m, sid, (d, st) => ({ state: openDocument(d, st, documentId) }));

export const answer = (deps: Deps, m: Member, sid: string, questionId: string, value: number | string) =>
  mutate(deps, m, sid, (d, st) => {
    const r = answerQuestion(d, st, questionId, value, deps.now().toISOString());
    return { state: r.state, result: { questionId, correct: r.correct } };
  });

export const highlight = (deps: Deps, m: Member, sid: string, documentId: string, text: string) =>
  mutate(deps, m, sid, (d, st) => {
    const r = collectHighlight(d, st, documentId, text, randomUUID(), deps.now().toISOString());
    const ev = r.evidenceId ? d.evidence.find((e) => e.id === r.evidenceId) : null;
    return { state: r.state, result: { evidenceId: r.evidenceId, label: ev?.label ?? null, isNew: r.isNew, kind: r.evidenceId ? 'evidence' : 'clue' } };
  });

export const removeClue = (deps: Deps, m: Member, sid: string, clueId: string) =>
  mutate(deps, m, sid, (_d, st) => ({ state: { ...st, clues: st.clues.filter((c) => c.id !== clueId) } }));

export const board = (deps: Deps, m: Member, sid: string, update: BoardUpdate) => mutate(deps, m, sid, (_d, st) => ({ state: updateBoard(st, update) }));

export const conclude = (deps: Deps, m: Member, sid: string, c: { optionId: string; supportingEvidenceIds: string[]; justification: string }) =>
  mutate(deps, m, sid, (d, st) => {
    if (isInappropriate(c.justification)) throw new ApiError('CONTENT_BLOCKED', 'Please keep your writing appropriate for a classroom.');
    return { state: setConclusion(d, st, c) };
  });

export const hint = (deps: Deps, m: Member, sid: string, stage: HintStage) =>
  mutate(deps, m, sid, (d, st) => {
    const r = nextHint(d, st, stage);
    return { state: r.state, result: { hint: r.hint, level: r.level, stage } };
  });

/* ------------------------------------------------------------------ */
/* Notebook & draft (autosave)                                         */
/* ------------------------------------------------------------------ */

export async function saveNotebook(deps: Deps, m: Member, sid: string, text: string) {
  const s = await loadOwnSession(deps, m, sid);
  if (s.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', 'This investigation has already been submitted');
  const doc: NotebookDoc = { text: text.slice(0, 20000), updatedAt: deps.now().toISOString() };
  await paths(deps.db).notebook(m.tenantId, sid).set(doc);
  return doc;
}

/** Saves the report draft. `baseVersion` must match the stored version (prevents overwriting a newer draft from another tab). */
export async function saveDraft(deps: Deps, m: Member, sid: string, text: string, baseVersion: number) {
  const p = paths(deps.db);
  return deps.db.runTransaction(async (tx) => {
    const s = (await tx.get(p.session(m.tenantId, sid))).data() as SessionDoc | undefined;
    if (!s) throw notFound('Investigation');
    if (s.uid !== m.uid) throw forbidden('This is not your investigation');
    if (s.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', 'This investigation has already been submitted');
    const cur = (await tx.get(p.draft(m.tenantId, sid))).data() as DraftDoc | undefined;
    const curVersion = cur?.version ?? 0;
    if (baseVersion !== curVersion) {
      if (cur && cur.text === text) return cur; // identical retry
      throw new ApiError('DRAFT_CONFLICT', 'A newer version of your draft exists (another tab or device).', { current: cur });
    }
    const doc: DraftDoc = { text: text.slice(0, 12000), version: curVersion + 1, wordCount: wordCount(text), updatedAt: deps.now().toISOString() };
    tx.set(p.draft(m.tenantId, sid), doc);
    tx.update(p.session(m.tenantId, sid), { lastActivityAt: doc.updatedAt });
    return doc;
  });
}

/* ------------------------------------------------------------------ */
/* AI interactions: interviews and assistant                           */
/* ------------------------------------------------------------------ */

type ClaimResult<T> = { replay: T } | { session: SessionDoc; warning: boolean };

/** Claims the per-session AI lock + quota, with idempotency by clientMessageId. */
async function claimAi<T>(
  deps: Deps,
  m: Member,
  sid: string,
  messageRef: FirebaseFirestore.DocumentReference,
  check: (s: SessionDoc) => void,
  placeholder: Record<string, unknown>,
  toReplay: (doc: Record<string, unknown>) => T,
): Promise<ClaimResult<T>> {
  const p = paths(deps.db);
  const tenant = await getTenant(deps, m.tenantId);
  const s0 = await loadOwnSession(deps, m, sid);
  const courseBudget = s0.courseId ? (((await p.course(m.tenantId, s0.courseId).get()).data() as CourseDoc | undefined)?.monthlyBudgetUsd ?? null) : null;
  return deps.db.runTransaction(async (tx) => {
    const ref = p.session(m.tenantId, sid);
    const [sSnap, mSnap] = await Promise.all([tx.get(ref), tx.get(messageRef)]);
    const s = sSnap.data() as SessionDoc;
    const existing = mSnap.data() as Record<string, unknown> | undefined;
    if (existing?.status === 'done') return { replay: toReplay(existing) };
    if (existing?.status === 'processing') throw new ApiError('REQUEST_IN_PROGRESS', 'This request is already being processed.');
    if (s.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', 'This investigation has already been submitted');
    const now = deps.now();
    if (s.lockId && s.lockId !== messageRef.id && s.lockSince && now.getTime() - new Date(s.lockSince).getTime() < LOCK_STALE_MS) {
      throw new ApiError('REQUEST_IN_PROGRESS', 'Please wait for the previous answer.');
    }
    check(s);
    const q = await reserveAiCall(deps, tx, tenant, m.uid, s.courseId, courseBudget);
    q.commit();
    tx.set(messageRef, { ...placeholder, id: messageRef.id, status: 'processing', createdAt: now.toISOString() });
    tx.update(ref, { lockId: messageRef.id, lockSince: now.toISOString() });
    return { session: s, warning: q.check.warning };
  });
}

async function releaseAi(deps: Deps, m: Member, sid: string, messageRef: FirebaseFirestore.DocumentReference) {
  const ref = paths(deps.db).session(m.tenantId, sid);
  await deps.db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data() as SessionDoc;
    tx.set(messageRef, { status: 'failed' }, { merge: true });
    if (s.lockId === messageRef.id) tx.update(ref, { lockId: null, lockSince: null });
  });
}

export async function interview(deps: Deps, m: Member, sid: string, input: { clientMessageId: string; characterId: string; question: string }) {
  const p = paths(deps.db);
  const tenant = await getTenant(deps, m.tenantId);
  const s0 = await loadOwnSession(deps, m, sid);
  const d = await getCaseVersion(deps, m.tenantId, s0.caseId, s0.caseVersion);
  const c = d.characters.find((x) => x.id === input.characterId);
  if (!c) throw notFound('Character');
  if (isInappropriate(input.question)) throw new ApiError('CONTENT_BLOCKED', 'Please keep your questions appropriate for a classroom.');
  const limits = sessionLimits(d, tenant);
  const msgRef = p.message(m.tenantId, sid, input.clientMessageId);

  const claim = await claimAi(
    deps, m, sid, msgRef,
    (s) => {
      if ((s.state.interviewCounts[c.id] ?? 0) >= limits.interviewQuestionsPerCharacter) throw new ApiError('INTERVIEW_LIMIT', `You have used all questions for ${c.name}.`);
      if (s.interviewTotal >= limits.interviewQuestionsPerSession) throw new ApiError('INTERVIEW_LIMIT', 'You have used all interview questions for this investigation.');
    },
    { characterId: c.id, question: input.question },
    (doc) => doc as unknown as InterviewMessageDoc,
  );
  if ('replay' in claim) return { message: claim.replay!, ...(await buildView(deps, m.tenantId, s0, d, tenant)) };
  const s = claim.session;

  try {
    const eligible = eligibleFacts(d, s.state, c.id);
    const history = (await p.messages(m.tenantId, sid).where('characterId', '==', c.id).orderBy('createdAt').get()).docs
      .map((x) => x.data() as InterviewMessageDoc)
      .filter((x) => x.status === 'done')
      .map((x) => ({ question: x.question, reply: x.reply }));
    const model = deps.config.geminiModel ?? tenant.aiConfig.model;
    const started = Date.now();
    let reply = CHARACTER_FALLBACK;
    let proposed: string[] = [];
    let fallback = false;
    let blocked: string | null = null;
    try {
      const r = await withRetry(
        () => deps.ai.character({ dossier: d, characterId: c.id, eligibleFacts: eligible.map((f) => ({ id: f.id, text: f.text })), alreadyRevealedFactIds: s.state.revealedFactIds, history, question: input.question, model, temperature: tenant.aiConfig.temperature, maxOutputTokens: tenant.quotas.maxOutputTokens }),
        { retries: deps.config.aiMaxRetries, timeoutMs: deps.config.aiTimeoutMs },
      );
      void recordUsage(deps, tenant, { kind: 'character', uid: m.uid, sessionId: sid, courseId: s.courseId, model, ...r.usage, ok: true, latencyMs: Date.now() - started });
      const g = guardCharacterReply(d, c.id, eligible.map((f) => f.id), r.output);
      reply = g.output.reply;
      proposed = g.output.factsRevealed;
      blocked = g.blocked;
    } catch (e) {
      console.error('AI character failed – fallback', e);
      void recordUsage(deps, tenant, { kind: 'character', uid: m.uid, sessionId: sid, courseId: s.courseId, model, ok: false, latencyMs: Date.now() - started });
      reply = `${c.name.split(' ')[0]} seems busy right now. Please ask your question again in a moment.`;
      fallback = true;
    }

    return await deps.db.runTransaction(async (tx) => {
      const ref = p.session(m.tenantId, sid);
      const cur = (await tx.get(ref)).data() as SessionDoc;
      if (cur.lockId !== msgRef.id) throw new ApiError('CONFLICT', 'The investigation changed while processing. Please retry.');
      const revealed = revealFacts(d, cur.state, c.id, fallback ? [] : proposed);
      const state = fallback ? cur.state : countInterview(revealed.state, c.id);
      const now = deps.now().toISOString();
      const msg: InterviewMessageDoc = {
        id: msgRef.id,
        characterId: c.id,
        question: input.question.slice(0, 600),
        reply,
        factsRevealed: revealed.accepted,
        unlockedDocumentIds: revealed.newlyUnlockedDocumentIds,
        fallback,
        blocked,
        createdAt: now,
        status: 'done',
      };
      const next: SessionDoc = { ...cur, state, interviewTotal: cur.interviewTotal + (fallback ? 0 : 1), lockId: null, lockSince: null, lastActivityAt: now };
      tx.set(msgRef, msg);
      tx.set(ref, next);
      return next;
    }).then(async (next) => ({
      message: (await msgRef.get()).data() as InterviewMessageDoc,
      quotaWarning: claim.warning,
      ...(await buildView(deps, m.tenantId, next, d, tenant)),
    }));
  } catch (e) {
    await releaseAi(deps, m, sid, msgRef).catch(() => undefined);
    throw e;
  }
}

export async function askAssistant(deps: Deps, m: Member, sid: string, input: { clientMessageId: string; stage: string; question: string }) {
  const p = paths(deps.db);
  const tenant = await getTenant(deps, m.tenantId);
  const s0 = await loadOwnSession(deps, m, sid);
  const d = await getCaseVersion(deps, m.tenantId, s0.caseId, s0.caseVersion);
  if (isInappropriate(input.question)) throw new ApiError('CONTENT_BLOCKED', 'Please keep your questions appropriate for a classroom.');
  const limits = sessionLimits(d, tenant);
  const msgRef = p.assistantMessage(m.tenantId, sid, input.clientMessageId);
  const claim = await claimAi(
    deps, m, sid, msgRef,
    (s) => {
      if (s.state.assistantCount >= limits.assistantRequests) throw new ApiError('ASSISTANT_LIMIT', 'You have used all assistant requests for this investigation.');
    },
    { stage: input.stage, question: input.question },
    (doc) => doc as unknown as AssistantMessageDoc,
  );
  if ('replay' in claim) return { message: claim.replay! };
  const s = claim.session;
  try {
    const model = deps.config.geminiModel ?? tenant.aiConfig.model;
    const started = Date.now();
    let answerText = 'The assistant is not available right now. Try the hints, or read the documents again carefully.';
    let kind = 'unavailable';
    try {
      const r = await withRetry(
        () => deps.ai.assistant({ dossier: d, unlockedDocuments: unlockedDocuments(d, s.state).map((x) => ({ id: x.id, title: x.title, body: x.body })), stage: input.stage, question: input.question, level: d.level, model, maxOutputTokens: tenant.quotas.maxOutputTokens }),
        { retries: deps.config.aiMaxRetries, timeoutMs: deps.config.aiTimeoutMs },
      );
      void recordUsage(deps, tenant, { kind: 'assistant', uid: m.uid, sessionId: sid, courseId: s.courseId, model, ...r.usage, ok: true, latencyMs: Date.now() - started });
      const blocked = guardAssistantAnswer(d, r.output.answer);
      answerText = blocked ? "I can't tell you the solution, but compare each claim with an official document and ask who can confirm it." : r.output.answer;
      kind = blocked ? 'refused' : r.output.kind;
    } catch (e) {
      console.error('AI assistant failed', e);
      void recordUsage(deps, tenant, { kind: 'assistant', uid: m.uid, sessionId: sid, courseId: s.courseId, model, ok: false, latencyMs: Date.now() - started });
    }
    const counted = kind !== 'unavailable';
    const now = deps.now().toISOString();
    const msg: AssistantMessageDoc = { id: msgRef.id, stage: input.stage, question: input.question.slice(0, 600), answer: answerText, kind, createdAt: now, status: 'done' };
    await deps.db.runTransaction(async (tx) => {
      const ref = p.session(m.tenantId, sid);
      const cur = (await tx.get(ref)).data() as SessionDoc;
      tx.set(msgRef, msg);
      tx.update(ref, {
        'state.assistantCount': cur.state.assistantCount + (counted ? 1 : 0),
        lockId: cur.lockId === msgRef.id ? null : cur.lockId,
        lockSince: cur.lockId === msgRef.id ? null : cur.lockSince,
        lastActivityAt: now,
      });
    });
    return { message: msg, quotaWarning: claim.warning };
  } catch (e) {
    await releaseAi(deps, m, sid, msgRef).catch(() => undefined);
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

export async function submitReport(deps: Deps, m: Member, sid: string, input: { text: string; draftVersion: number }) {
  const p = paths(deps.db);
  const s0 = await loadOwnSession(deps, m, sid);
  const d = await getCaseVersion(deps, m.tenantId, s0.caseId, s0.caseVersion);
  if (isInappropriate(input.text)) throw new ApiError('CONTENT_BLOCKED', 'Please keep your report appropriate for a classroom.');
  const wc = wordCount(input.text);
  return deps.db.runTransaction(async (tx) => {
    const ref = p.session(m.tenantId, sid);
    const s = (await tx.get(ref)).data() as SessionDoc;
    if (s.status !== 'active') return { status: s.status, alreadySubmitted: true }; // idempotent
    const blockers = submissionBlockers(d, s.state);
    if (wc < Math.ceil(d.writingTask.minWords * 0.5)) blockers.push(`Your report is too short (${wc} words). Aim for ${d.writingTask.minWords}–${d.writingTask.maxWords} words.`);
    if (blockers.length) throw new ApiError('NOT_READY_TO_SUBMIT', 'Not ready to submit yet', { blockers });
    const now = deps.now().toISOString();
    tx.set(p.report(m.tenantId, sid), { sessionId: sid, uid: m.uid, caseId: s.caseId, text: input.text.slice(0, 12000), wordCount: wc, draftVersion: input.draftVersion, submittedAt: now });
    tx.set(p.draft(m.tenantId, sid), { text: input.text.slice(0, 12000), version: input.draftVersion + 1, wordCount: wc, updatedAt: now });
    tx.update(ref, { status: 'submitted', submittedAt: now, lastActivityAt: now });
    return { status: 'submitted' as const, alreadySubmitted: false };
  });
}
