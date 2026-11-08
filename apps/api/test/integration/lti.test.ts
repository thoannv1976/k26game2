import { createHash, randomUUID } from 'node:crypto';
import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeAiProvider } from '@ed/ai';
import { getBuiltinCase } from '@ed/game-engine';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDeps, type Deps } from '../../src/deps.js';
import { TICKET_TYP } from '../../src/lti/hubSdk.js';
import { api, createTenant, createUser, uuid, type TestCtx, type TestUser } from '../helpers.js';
import { playViaApi } from '../play-api.js';

/** UniGame Hub (LTI 1.3) adapter: ticket sign-in, provisioning, and grade sync to the Hub. */
const HUB = 'https://hub.test';
const GAME_ID = 'k26game2';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ed';

let ctx: TestCtx;
let deps: Deps;
let tenantId: string;
let hubKey: CryptoKey;
const hubCalls: Array<{ url: string; result: Record<string, unknown> }> = [];

/** Same uid as English City Simulator (Game 1) computes for this Hub user. */
const ltiUid = (sub: string) => `lti-${createHash('sha256').update(sub).digest('hex').slice(0, 28)}`;

async function ticket(over: Record<string, unknown> = {}, sub = `u_${randomUUID().slice(0, 12)}`) {
  return new SignJWT({
    ugh: {
      tenantId: 'hub-tenant',
      platform: { issuer: 'https://moodle.test', deploymentId: '3' },
      ltiSub: '42',
      name: 'Nguyễn Văn B',
      email: 'b@moodle.test',
      role: 'learner',
      context: { id: 'course-7', title: 'English 2', label: 'ENG2' },
      resourceLink: { id: 'rl-9', title: 'Scholarship case' },
      activity: 'CASE01',
      gradeTarget: 'gt_abc123',
      launchId: 'L1',
      ...over,
    },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'hub1', typ: TICKET_TYP })
    .setIssuer(HUB)
    .setAudience(GAME_ID)
    .setSubject(sub)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(hubKey);
}

async function signInWithCustomToken(token: string): Promise<string> {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, returnSecureToken: true }),
  });
  const json = (await res.json()) as { idToken?: string };
  if (!json.idToken) throw new Error('custom token sign-in failed');
  return json.idToken;
}

const launch = (t: string) => ctx.app.inject({ method: 'POST', url: '/api/lti/launch', payload: { ticket: t } });

async function launchAs(over: Record<string, unknown>, sub?: string) {
  const r = await launch(await ticket(over, sub));
  expect(r.statusCode, r.body).toBe(200);
  const { customToken, redirect } = r.json() as { customToken: string; redirect: string };
  const user: TestUser = { uid: (decodeJwt(customToken) as { uid: string }).uid, email: '', token: await signInWithCustomToken(customToken) };
  return { user, redirect, assignmentId: redirect.split('assignment=')[1] };
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  hubKey = privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'hub1', alg: 'RS256' }] });
  const config = loadConfig({
    env: 'test', projectId: PROJECT, aiProvider: 'fake', aiMaxRetries: 1, aiTimeoutMs: 2000, gradingTimeoutMs: 3000, rateLimitPerMinute: 100000,
    ltiEnabled: true, ltiHubUrl: HUB, ltiGameId: GAME_ID, ltiGameSecret: 'x'.repeat(40), ltiTenantMap: { 'hub-tenant': 'pending' },
  });
  const ltiFetch: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { result_token: string };
    hubCalls.push({ url: String(url), result: decodeJwt(body.result_token).result as Record<string, unknown> });
    return new Response(JSON.stringify({ status: 'queued', job_id: `job-${hubCalls.length}` }), { status: 202 });
  };
  const ai = new FakeAiProvider();
  deps = createDeps(config, { ai, ltiJwks: jwks, ltiFetch });
  ctx = { app: await buildApp(deps, { logger: false }), deps, ai };
  tenantId = (await createTenant(deps)).id;
  deps.config.ltiTenantMap = { 'hub-tenant': tenantId };
});

describe('LTI launch', () => {
  it('signs a learner in, enrols them and deep-links to the case assignment', async () => {
    const sub = `u_${randomUUID().slice(0, 12)}`;
    const r = await launch(await ticket({}, sub));
    expect(r.statusCode, r.body).toBe(200);
    const { customToken, redirect } = r.json() as { customToken: string; redirect: string };
    expect(redirect).toMatch(/^\/cases\/CASE01\?assignment=lti-[0-9a-f]{20}$/);
    const uid = (decodeJwt(customToken) as { uid: string }).uid;
    expect(uid).toBe(ltiUid(sub)); // one account across the K26 games
    const user = await deps.auth.getUser(uid);
    expect(user.customClaims).toMatchObject({ tenantId, role: 'student' });
    expect(user.email).toBeUndefined(); // never keyed by e-mail
    const assignmentId = redirect.split('assignment=')[1]!;
    const a = (await deps.db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get()).data()!;
    expect(a).toMatchObject({ caseId: 'CASE01', source: 'lti' });
    const c = (await deps.db.doc(`tenants/${tenantId}/courses/${a.courseId}`).get()).data()!;
    expect(c.studentIds).toContain(uid);
    expect(c.name).toBe('English 2');
    const profile = (await deps.db.doc(`tenants/${tenantId}/users/${uid}`).get()).data()!;
    expect(profile).toMatchObject({ role: 'student', courseIds: [a.courseId], level: 'B1' });
    const link = (await deps.db.doc(`tenants/${tenantId}/lti_links/${uid}_${assignmentId}`).get()).data();
    expect(link).toMatchObject({ gradeTarget: 'gt_abc123' });

    // The student sees the assignment on their dashboard (used by the case briefing page).
    const token = await signInWithCustomToken(customToken);
    const progress = await api(ctx, { uid, email: '', token }, 'GET', '/api/student/progress');
    expect(progress.status, JSON.stringify(progress.body)).toBe(200);
    expect(progress.body.assignments.map((x: any) => x.id)).toContain(assignmentId);
  });

  it('rejects a reused ticket, a forged ticket, an unmapped tenant and an unknown case', async () => {
    const t = await ticket();
    expect((await launch(t)).statusCode).toBe(200);
    expect((await launch(t)).statusCode).toBe(401);
    const forged = await new SignJWT({ ugh: {} }).setProtectedHeader({ alg: 'RS256', kid: 'hub1', typ: TICKET_TYP }).setIssuer(HUB).setAudience(GAME_ID)
      .setSubject('x').setJti(uuid()).setIssuedAt().setExpirationTime('2m').sign((await generateKeyPair('RS256')).privateKey);
    expect((await launch(forged)).statusCode).toBe(401);
    const wrongGame = await new SignJWT({ ugh: {} }).setProtectedHeader({ alg: 'RS256', kid: 'hub1', typ: TICKET_TYP }).setIssuer(HUB).setAudience('k26game1')
      .setSubject('x').setJti(uuid()).setIssuedAt().setExpirationTime('2m').sign(hubKey);
    expect((await launch(wrongGame)).statusCode).toBe(401);
    expect((await launch(await ticket({ tenantId: 'other-school' }))).statusCode).toBe(403);
    expect((await launch(await ticket({ activity: 'CASE99', resourceLink: { id: 'rl-99' } }))).statusCode).toBe(404);
  });

  it('makes instructors teachers of the course and sends them to the class page', async () => {
    const r = await launch(await ticket({ role: 'instructor', gradeTarget: undefined }));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().redirect).toMatch(/^\/teacher\/classes\/lti-/);
    const uid = (decodeJwt(r.json().customToken) as { uid: string }).uid;
    expect((await deps.auth.getUser(uid)).customClaims).toMatchObject({ role: 'teacher' });
  });

  it('reuses an account created by another K26 game and keeps its claims compatible', async () => {
    // Created by Game 1's LTI launch: same uid and claims, but no profile in this game's database yet.
    const sub = `u_${randomUUID().slice(0, 12)}`;
    await deps.auth.createUser({ uid: ltiUid(sub), displayName: 'From Game 1' });
    await deps.auth.setCustomUserClaims(ltiUid(sub), { tenantId, role: 'school_admin' });
    const r = await launch(await ticket({ resourceLink: { id: 'rl-admin' } }, sub));
    expect(r.statusCode, r.body).toBe(200);
    expect((await deps.auth.getUser(ltiUid(sub))).customClaims).toMatchObject({ tenantId, role: 'school_admin' }); // never downgraded
    expect(r.json().redirect).toMatch(/^\/teacher\/classes\/lti-/);
    expect((await deps.db.doc(`tenants/${tenantId}/users/${ltiUid(sub)}`).get()).data()).toMatchObject({ role: 'school_admin' });

    const other = `u_${randomUUID().slice(0, 12)}`;
    await deps.auth.createUser({ uid: ltiUid(other) });
    await deps.auth.setCustomUserClaims(ltiUid(other), { tenantId: 'another-school', role: 'student' });
    expect((await launch(await ticket({}, other))).statusCode).toBe(409);
  });

  it('is invisible when LTI is disabled', async () => {
    const off = await buildApp(createDeps(loadConfig({ env: 'test', projectId: PROJECT, aiProvider: 'fake' }), { ai: new FakeAiProvider() }), { logger: false });
    expect((await off.inject({ method: 'POST', url: '/api/lti/launch', payload: { ticket: 'x'.repeat(40) } })).statusCode).toBe(404);
  });
});

describe('grade sync', () => {
  it('reports the graded percent and the teacher re-score for LTI assignments only', async () => {
    const rl = { id: 'rl-grade', title: 'Graded case' };
    const { user: student, assignmentId } = await launchAs({ gradeTarget: 'gt_grade1', resourceLink: rl }, 'u_grader');
    const sessionId = await playViaApi(ctx, student, getBuiltinCase('CASE01')!, { assignmentId });
    const s = (await deps.db.doc(`tenants/${tenantId}/investigation_sessions/${sessionId}`).get()).data()!;
    expect(s.assignmentId).toBe(assignmentId);

    // Grading runs on the first status check after submission; the result is sent when it completes.
    const before = hubCalls.length;
    const res = await api(ctx, student, 'GET', `/api/sessions/${sessionId}/results`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('graded');
    expect(hubCalls.length).toBe(before + 1);
    const first = hubCalls.at(-1)!;
    expect(first.url).toBe(`${HUB}/api/v1/results`);
    expect(first.result).toMatchObject({
      grade_target: 'gt_grade1', attempt_id: sessionId, score: res.body.assessment.finalPercent, max_score: 100,
      activity_progress: 'Completed', grading_progress: 'FullyGraded',
    });
    // Polling again does not resend.
    await api(ctx, student, 'GET', `/api/sessions/${sessionId}/results`);
    expect(hubCalls.length).toBe(before + 1);

    // Teacher of the LTI course re-scores: a newer result is sent for the same attempt.
    const { user: teacher } = await launchAs({ role: 'instructor', gradeTarget: undefined, resourceLink: rl }, 'u_teacher1');
    const rev = await api(ctx, teacher, 'PUT', `/api/teacher/assessments/${sessionId}/review`, { scores: { writing: 3 }, comment: 'Well done' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(hubCalls.length).toBe(before + 2);
    const second = hubCalls.at(-1)!;
    expect(second.result).toMatchObject({ grade_target: 'gt_grade1', attempt_id: sessionId, score: rev.body.assessment.finalPercent, comment: 'Well done', grading_progress: 'FullyGraded' });
    expect(second.result.score).not.toBe(first.result.score);
    expect(Date.parse(String(second.result.occurred_at))).toBeGreaterThan(Date.parse(String(first.result.occurred_at)));
    const outbox = (await deps.db.doc(`tenants/${tenantId}/lti_outbox/${sessionId}`).get()).data();
    expect(outbox).toMatchObject({ status: 'queued', finalPercent: rev.body.assessment.finalPercent });
  });

  it('links an open session to the assignment when it is resumed from the LMS', async () => {
    const { user: student, assignmentId } = await launchAs({ activity: 'CASE02', gradeTarget: 'gt_resume', resourceLink: { id: 'rl-resume' } });
    const first = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE02', restart: true });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const resumed = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE02', assignmentId });
    expect(resumed.body).toMatchObject({ resumed: true, session: { id: first.body.session.id } });
    const s = (await deps.db.doc(`tenants/${tenantId}/investigation_sessions/${first.body.session.id}`).get()).data()!;
    expect(s.assignmentId).toBe(assignmentId);
  });

  it('does not report sessions that are not tied to an LTI assignment', async () => {
    const plain = await createUser(deps, tenantId, 'student');
    const before = hubCalls.length;
    const sid = await playViaApi(ctx, plain, getBuiltinCase('CASE01')!);
    expect((await api(ctx, plain, 'GET', `/api/sessions/${sid}/results`)).body.status).toBe('graded');
    expect(hubCalls.length).toBe(before);
  });
});
