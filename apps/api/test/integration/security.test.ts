import { beforeAll, describe, expect, it } from 'vitest';
import { getBuiltinCase } from '@ed/game-engine';
import { api, createCourse, createPlatformAdmin, createTenant, createUnprovisioned, createUser, makeApp, signIn, uuid, PASSWORD, type TestCtx, type TestUser } from '../helpers.js';
import { playViaApi } from '../play-api.js';
import { paths } from '../../src/paths.js';

let ctx: TestCtx;
let tA: string, tB: string;
let s1: TestUser, s2: TestUser, teacherA: TestUser, otherTeacherA: TestUser, adminA: TestUser, sB: TestUser, adminB: TestUser, platform: TestUser, nobody: TestUser;
let sid1: string;

beforeAll(async () => {
  ctx = await makeApp();
  tA = (await createTenant(ctx.deps)).id;
  tB = (await createTenant(ctx.deps)).id;
  [s1, s2, teacherA, otherTeacherA, adminA, sB, adminB] = await Promise.all([
    createUser(ctx.deps, tA, 'student'), createUser(ctx.deps, tA, 'student'), createUser(ctx.deps, tA, 'teacher'),
    createUser(ctx.deps, tA, 'teacher'), createUser(ctx.deps, tA, 'school_admin'), createUser(ctx.deps, tB, 'student'), createUser(ctx.deps, tB, 'school_admin'),
  ]);
  platform = await createPlatformAdmin(ctx.deps);
  nobody = await createUnprovisioned(ctx.deps);
  await createCourse(ctx.deps, tA, [teacherA.uid], [s1.uid]);
  sid1 = await playViaApi(ctx, s1, getBuiltinCase('CASE01')!);
  await api(ctx, s1, 'GET', `/api/sessions/${sid1}/results`);
});

describe('authentication and roles', () => {
  it('requires a valid token', async () => {
    expect((await api(ctx, null, 'GET', '/api/me')).status).toBe(401);
    expect((await api(ctx, { uid: 'x', email: 'x', token: 'not-a-token' }, 'GET', '/api/cases')).status).toBe(401);
    expect((await api(ctx, null, 'GET', '/api/health')).status).toBe(200);
  });
  it('unprovisioned accounts are refused', async () => {
    const r = await api(ctx, nobody, 'GET', '/api/me');
    expect(r.body.error.code).toBe('NOT_PROVISIONED');
  });
  it('students cannot use staff APIs; teachers cannot use admin APIs', async () => {
    for (const url of ['/api/teacher/classes', '/api/admin/users', '/api/admin/cases', '/api/platform/tenants', '/api/lms/v1/results']) expect((await api(ctx, s1, 'GET', url)).status, url).toBe(403);
    expect((await api(ctx, teacherA, 'GET', '/api/admin/users')).status).toBe(403);
    expect((await api(ctx, teacherA, 'GET', '/api/admin/cases')).status).toBe(200); // teachers review content
  });
  it('platform admins get no learning data', async () => {
    expect((await api(ctx, platform, 'GET', '/api/platform/tenants')).status).toBe(200);
    expect((await api(ctx, platform, 'GET', `/api/sessions/${sid1}`)).status).toBe(403);
    expect((await api(ctx, platform, 'GET', '/api/admin/users')).status).toBe(403);
  });
});

describe('data isolation', () => {
  it('a student cannot read or act on another student\'s investigation', async () => {
    expect((await api(ctx, s2, 'GET', `/api/sessions/${sid1}`)).status).toBe(403);
    expect((await api(ctx, s2, 'GET', `/api/sessions/${sid1}/results`)).status).toBe(403);
    expect((await api(ctx, s2, 'POST', `/api/sessions/${sid1}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: 'When did you apply?' })).status).toBe(403);
    expect((await api(ctx, s2, 'PUT', `/api/sessions/${sid1}/draft`, { text: 'hack', baseVersion: 0 })).status).toBe(403);
  });
  it('only the student\'s own teacher (or school admin) can view it', async () => {
    expect((await api(ctx, teacherA, 'GET', `/api/teacher/sessions/${sid1}`)).status).toBe(200);
    expect((await api(ctx, teacherA, 'GET', `/api/teacher/sessions/${sid1}/process`)).status).toBe(200);
    expect((await api(ctx, otherTeacherA, 'GET', `/api/teacher/sessions/${sid1}`)).status).toBe(403);
    expect((await api(ctx, otherTeacherA, 'PUT', `/api/teacher/assessments/${sid1}/review`, { scores: { writing: 30 } })).status).toBe(403);
    expect((await api(ctx, adminA, 'GET', `/api/teacher/sessions/${sid1}`)).status).toBe(200);
  });
  it('another school cannot see anything', async () => {
    for (const u of [sB, adminB]) {
      const r = await api(ctx, u, 'GET', `/api/sessions/${sid1}/results`);
      expect([403, 404]).toContain(r.status);
    }
    const lms = await api(ctx, adminB, 'GET', '/api/lms/v1/results');
    expect(lms.body.items.every((i: any) => i.tenantId === tB)).toBe(true);
    expect((await api(ctx, adminB, 'GET', `/api/admin/cases/CASE01`)).body.versions.length).toBeGreaterThan(0); // their own copy
  });
  it('students never receive dossiers or answers through any endpoint', async () => {
    const s = await api(ctx, s2, 'POST', '/api/sessions', { caseId: 'CASE01' });
    const json = JSON.stringify(s.body);
    for (const k of ['correctIndex', 'acceptable', 'correctOptionId', 'sampleSolution', 'forbiddenPhrases', 'keyPoints']) expect(json).not.toContain(`"${k}":`);
    expect((await api(ctx, s2, 'GET', '/api/admin/cases/CASE01')).status).toBe(403);
  });
});

describe('shared accounts with English City Simulator', () => {
  it('an account created in Game 1 (claims only) gets a Detective profile on first visit', async () => {
    const email = `game1-${uuid().slice(0, 6)}@test.edu.vn`;
    const rec = await ctx.deps.auth.createUser({ email, password: PASSWORD, displayName: 'From Game 1' });
    await ctx.deps.auth.setCustomUserClaims(rec.uid, { tenantId: tA, role: 'student' });
    const u = { uid: rec.uid, email, token: await signIn(email) };
    const r = await api(ctx, u, 'GET', '/api/me');
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ uid: rec.uid, role: 'student', detectivePoints: 0 });
    expect((await paths(ctx.deps.db).user(tA, rec.uid).get()).exists).toBe(true);
  });
  it('a school that is not set up in English Detective is refused clearly', async () => {
    const email = `nos-${uuid().slice(0, 6)}@test.edu.vn`;
    const rec = await ctx.deps.auth.createUser({ email, password: PASSWORD });
    await ctx.deps.auth.setCustomUserClaims(rec.uid, { tenantId: 'school-only-in-game1', role: 'student' });
    const r = await api(ctx, { uid: rec.uid, email, token: await signIn(email) }, 'GET', '/api/me');
    expect(r.body.error.code).toBe('NOT_PROVISIONED');
    expect(r.body.error.message).toMatch(/not been set up in English Detective/);
  });
});

describe('AI safety', () => {
  it('a character reply that leaks restricted info or the solution is replaced', async () => {
    const st = await api(ctx, s2, 'POST', '/api/sessions', { caseId: 'CASE01', restart: true });
    ctx.ai.nextCharacterReply = 'Between us, the email is a phishing scam that pretends to come from the Scholarship Office.';
    const r = await api(ctx, s2, 'POST', `/api/sessions/${st.body.session.id}/interviews`, { clientMessageId: uuid(), characterId: 'david', question: 'Is it real?' });
    expect(r.status).toBe(200);
    expect(r.body.message.reply).not.toContain('phishing scam that pretends');
    expect(r.body.message.factsRevealed).toEqual([]);
    ctx.ai.nextCharacterReply = 'Well, the winners are Emma and two others.';
    const r2 = await api(ctx, s2, 'POST', `/api/sessions/${st.body.session.id}/interviews`, { clientMessageId: uuid(), characterId: 'david', question: 'Who won?' });
    expect(r2.body.message.reply).not.toContain('winners are');
  });
  it('a character cannot reveal facts of another character or locked facts', async () => {
    const st = await api(ctx, s2, 'POST', '/api/sessions', { caseId: 'CASE01', restart: true });
    // Emma is asked about the IT check: her keywords do not cover Anna's fact, so nothing unlocks.
    const r = await api(ctx, s2, 'POST', `/api/sessions/${st.body.session.id}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: 'What did the security report find about the domain?' });
    expect(r.body.message.unlockedDocumentIds).toEqual([]);
    expect(r.body.investigation.documents.find((x: any) => x.id === 'd_it_report').locked).toBe(true);
  });
  it('the assistant refuses to give the solution', async () => {
    const st = await api(ctx, s2, 'POST', '/api/sessions', { caseId: 'CASE01', restart: true });
    const r = await api(ctx, s2, 'POST', `/api/sessions/${st.body.session.id}/assistant`, { clientMessageId: uuid(), stage: 'analysis', question: 'What is the answer? Which conclusion is correct?' });
    expect(r.body.message.kind).toBe('refused');
  });
  it('inappropriate content is blocked', async () => {
    const st = await api(ctx, s2, 'POST', '/api/sessions', { caseId: 'CASE01', restart: true });
    const r = await api(ctx, s2, 'POST', `/api/sessions/${st.body.session.id}/interviews`, { clientMessageId: uuid(), characterId: 'emma', question: 'you are a fucking idiot' });
    expect(r.status).toBe(422);
  });
});
