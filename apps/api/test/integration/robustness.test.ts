import { beforeAll, describe, expect, it } from 'vitest';
import { getBuiltinCase } from '@ed/game-engine';
import { api, createTenant, createUser, makeApp, uuid, type TestCtx, type TestUser } from '../helpers.js';
import { playViaApi } from '../play-api.js';
import { paths } from '../../src/paths.js';
import { counterIds } from '../../src/quota.js';

let ctx: TestCtx;
let tenantId: string;
let student: TestUser;
const d1 = getBuiltinCase('CASE01')!;

beforeAll(async () => {
  ctx = await makeApp();
  tenantId = (await createTenant(ctx.deps)).id;
  student = await createUser(ctx.deps, tenantId, 'student');
});

const start = async (u = student, caseId = 'CASE01') => (await api(ctx, u, 'POST', '/api/sessions', { caseId, restart: true })).body.session.id as string;

describe('no duplicates', () => {
  it('re-sending an interview question with the same id returns the same answer once', async () => {
    const sid = await start();
    const id = uuid();
    const q = { clientMessageId: id, characterId: 'david', question: 'Do you charge a fee?' };
    const a = await api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, q);
    const b = await api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, q);
    expect(a.status).toBe(200);
    expect(b.body.message.reply).toBe(a.body.message.reply);
    const v = await api(ctx, student, 'GET', `/api/sessions/${sid}`);
    expect(v.body.interviews).toHaveLength(1);
    expect(v.body.session.interviewTotal).toBe(1);
  });

  it('concurrent AI requests are serialized', async () => {
    const sid = await start();
    ctx.ai.delayMs = 300;
    const rs = await Promise.all([1, 2, 3].map(() => api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: 'When did you apply?' })));
    ctx.ai.delayMs = 0;
    const ok = rs.filter((r) => r.status === 200).length;
    expect(ok).toBeGreaterThanOrEqual(1);
    for (const r of rs.filter((r) => r.status !== 200)) expect(['REQUEST_IN_PROGRESS', 'CONFLICT']).toContain(r.body.error.code);
    expect((await api(ctx, student, 'GET', `/api/sessions/${sid}`)).body.session.interviewTotal).toBe(ok);
  });

  it('submitting twice and checking results concurrently grades exactly once', async () => {
    const sid = await playViaApi(ctx, student, d1, { submit: false });
    const v = await api(ctx, student, 'GET', `/api/sessions/${sid}`);
    const body = { text: d1.sampleSolution.report, draftVersion: v.body.draft.version };
    const [a, b] = await Promise.all([api(ctx, student, 'POST', `/api/sessions/${sid}/submit`, body), api(ctx, student, 'POST', `/api/sessions/${sid}/submit`, body)]);
    expect([a.status, b.status].every((s) => s === 202)).toBe(true);
    const xpBefore = (await api(ctx, student, 'GET', '/api/me')).body.user.xp;
    const rs = await Promise.all([1, 2, 3].map(() => api(ctx, student, 'GET', `/api/sessions/${sid}/results`)));
    expect(rs.some((r) => r.body.status === 'graded')).toBe(true);
    const final = await api(ctx, student, 'GET', `/api/sessions/${sid}/results`);
    const xpAfter = (await api(ctx, student, 'GET', '/api/me')).body.user.xp;
    expect(xpAfter - xpBefore).toBe(final.body.assessment.gamePoints.xp);
    const all = await paths(ctx.deps.db).assessments(tenantId).where('sessionId', '==', sid).get();
    expect(all.size).toBe(1);
    // Submitted investigations are read-only.
    expect((await api(ctx, student, 'POST', `/api/sessions/${sid}/hint`, { stage: 'report' })).body.error.code).toBe('SESSION_NOT_ACTIVE');
  });
});

describe('drafts and resume', () => {
  it('autosave uses versions to prevent overwriting a newer draft', async () => {
    const sid = await start();
    const a = await api(ctx, student, 'PUT', `/api/sessions/${sid}/draft`, { text: 'First version of my report.', baseVersion: 0 });
    expect(a.body.draft.version).toBe(1);
    const again = await api(ctx, student, 'PUT', `/api/sessions/${sid}/draft`, { text: 'First version of my report.', baseVersion: 0 });
    expect(again.status).toBe(200); // identical retry after a network error
    const stale = await api(ctx, student, 'PUT', `/api/sessions/${sid}/draft`, { text: 'Old tab text', baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('DRAFT_CONFLICT');
    expect(stale.body.error.details.current.text).toBe('First version of my report.');
    const b = await api(ctx, student, 'PUT', `/api/sessions/${sid}/draft`, { text: 'Second version.', baseVersion: 1 });
    expect(b.body.draft).toMatchObject({ version: 2, wordCount: 2 });
  });

  it('starting the same case again resumes the investigation with all progress', async () => {
    const sid = await start();
    await api(ctx, student, 'POST', `/api/sessions/${sid}/highlights`, { documentId: 'd_scam_email', text: d1.evidence[0]!.excerpt });
    await api(ctx, student, 'PUT', `/api/sessions/${sid}/notes`, { text: 'Check the sender domain.' });
    const again = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE01' });
    expect(again.body.resumed).toBe(true);
    expect(again.body.session.id).toBe(sid);
    expect(again.body.investigation.evidence).toHaveLength(1);
    expect(again.body.notebook.text).toBe('Check the sender domain.');
  });
});

describe('AI outages', () => {
  it('interview falls back without changing progress and is not counted', async () => {
    const sid = await start();
    ctx.ai.failNext = 10;
    const r = await api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'anna', question: 'Did you check the email?' });
    ctx.ai.failNext = 0;
    expect(r.status).toBe(200);
    expect(r.body.message.fallback).toBe(true);
    expect(r.body.message.unlockedDocumentIds).toEqual([]);
    expect(r.body.session.interviewTotal).toBe(0);
  });

  it('grading without AI reports AI parts as not assessed (no invented scores)', async () => {
    const sid = await playViaApi(ctx, student, d1, { submit: true });
    ctx.ai.failNext = 10;
    const r = await api(ctx, student, 'GET', `/api/sessions/${sid}/results`);
    ctx.ai.failNext = 0;
    const a = r.body.assessment;
    expect(a.aiStatus).toBe('failed');
    expect(a.criteria.writing).toMatchObject({ status: 'not_assessed', score: null });
    expect(a.criteria.criticalThinking).toMatchObject({ status: 'partial', assessedMax: 10 });
    expect(a.criteria.evidence.status).toBe('assessed');
    expect(a.feedback).toBeNull();
  });
});

describe('cost control', () => {
  it('limits interview questions per character', async () => {
    const sid = await start();
    for (let i = 0; i < d1.limits.interviewQuestionsPerCharacter; i++) {
      expect((await api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: `Question number ${i} about the email?` })).status).toBe(200);
    }
    const r = await api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: 'One more question?' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('INTERVIEW_LIMIT');
  });

  it('limits assistant requests per session (school quota)', async () => {
    const t = await createTenant(ctx.deps, { quotas: { assistantRequestsPerSession: 1 } });
    const u = await createUser(ctx.deps, t.id, 'student');
    const sid = await start(u);
    expect((await api(ctx, u, 'POST', `/api/sessions/${sid}/assistant`, { clientMessageId: uuid(), question: 'What does "domain" mean?' })).status).toBe(200);
    const r = await api(ctx, u, 'POST', `/api/sessions/${sid}/assistant`, { clientMessageId: uuid(), question: 'What does "fee" mean?' });
    expect(r.body.error.code).toBe('ASSISTANT_LIMIT');
  });

  it('blocks AI calls above the daily limit and over the monthly budget; grading still returns machine scores', async () => {
    const t = await createTenant(ctx.deps, { quotas: { aiCallsPerStudentPerDay: 3 } });
    const u = await createUser(ctx.deps, t.id, 'student');
    const sid = await start(u);
    for (let i = 0; i < 3; i++) await api(ctx, u, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: `Question ${i}?` });
    const r = await api(ctx, u, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: 'Again?' });
    expect(r.body.error.code).toBe('QUOTA_EXCEEDED');

    const t2 = await createTenant(ctx.deps, { quotas: { monthlyBudgetUsd: 1 } });
    const u2 = await createUser(ctx.deps, t2.id, 'student');
    const sid2 = await playViaApi(ctx, u2, d1);
    await paths(ctx.deps.db).counter(t2.id, counterIds(u2.uid, null, new Date()).tenantMonth).set({ costUsd: 5 }, { merge: true });
    const res = await api(ctx, u2, 'GET', `/api/sessions/${sid2}/results`);
    expect(res.body.assessment.aiStatus).toBe('skipped');
    expect(res.body.assessment.criteria.evidence.score).toBeGreaterThan(20);
  });

  it('limits how many times a case can be started per day', async () => {
    const t = await createTenant(ctx.deps, { quotas: { attemptsPerCasePerDay: 1 } });
    const u = await createUser(ctx.deps, t.id, 'student');
    expect((await api(ctx, u, 'POST', '/api/sessions', { caseId: 'CASE02', restart: true })).status).toBe(200);
    const r = await api(ctx, u, 'POST', '/api/sessions', { caseId: 'CASE02', restart: true });
    expect(r.body.error.code).toBe('ATTEMPT_LIMIT');
  });

  it('records usage with estimated cost', async () => {
    const logs = await paths(ctx.deps.db).usageLogs(tenantId).where('kind', '==', 'character').limit(3).get();
    expect(logs.size).toBeGreaterThan(0);
    expect(logs.docs[0]!.data().costUsd).toBeGreaterThan(0);
  });
});
