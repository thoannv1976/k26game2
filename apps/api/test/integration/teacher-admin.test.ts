import { beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_CASES, getBuiltinCase } from '@ed/game-engine';
import { api, createCourse, createPlatformAdmin, createTenant, createUser, makeApp, signIn, uuid, type TestCtx, type TestUser } from '../helpers.js';
import { playViaApi } from '../play-api.js';

let ctx: TestCtx;
let tenantId: string;
let admin: TestUser, teacher: TestUser, s1: TestUser, s2: TestUser;
let courseId: string;
let sid: string;

beforeAll(async () => {
  ctx = await makeApp();
  tenantId = (await createTenant(ctx.deps)).id;
  [admin, teacher, s1, s2] = await Promise.all([
    createUser(ctx.deps, tenantId, 'school_admin'), createUser(ctx.deps, tenantId, 'teacher'), createUser(ctx.deps, tenantId, 'student'), createUser(ctx.deps, tenantId, 'student'),
  ]);
  courseId = await createCourse(ctx.deps, tenantId, [teacher.uid], [s1.uid, s2.uid]);
});

describe('teacher workflow', () => {
  it('assigns a case that the student sees and solves', async () => {
    const a = await api(ctx, teacher, 'POST', '/api/teacher/assignments', { courseId, caseId: 'CASE01', dueAt: '2027-03-15T10:00:00.000Z', note: 'Week 2' });
    expect(a.status).toBe(200);
    const prog = await api(ctx, s1, 'GET', '/api/student/progress');
    expect(prog.body.assignments.map((x: any) => x.caseId)).toEqual(['CASE01']);
    sid = await playViaApi(ctx, s1, getBuiltinCase('CASE01')!);
    expect((await api(ctx, s1, 'GET', `/api/sessions/${sid}/results`)).body.status).toBe('graded');
  });

  it('sees class progress, the investigation trail and results', async () => {
    const st = await api(ctx, s2, 'POST', '/api/sessions', { caseId: 'CASE02' });
    await api(ctx, s2, 'POST', `/api/sessions/${st.body.session.id}/briefing`);
    const cls = await api(ctx, teacher, 'GET', `/api/teacher/classes/${courseId}`);
    expect(cls.body.students).toHaveLength(2);
    expect(cls.body.results[0].sessionId).toBe(sid);
    expect(cls.body.inProgress.map((x: any) => x.caseId)).toContain('CASE02');
    expect(cls.body.assignments[0].submittedBy).toBe(1);
    const trail = await api(ctx, teacher, 'GET', `/api/teacher/sessions/${sid}/process`);
    expect(trail.body.interviews.length).toBeGreaterThan(0);
    expect(trail.body.draft.text.length).toBeGreaterThan(100);
  });

  it('reviews and adjusts the AI assessment', async () => {
    const r = await api(ctx, teacher, 'PUT', `/api/teacher/assessments/${sid}/review`, { scores: { writing: 22, criticalThinking: 18 }, comment: 'Good evidence, improve paragraph links.' });
    expect(r.status).toBe(200);
    expect(r.body.assessment.teacherReview.status).toBe('adjusted');
    const res = await api(ctx, s1, 'GET', `/api/sessions/${sid}/results`);
    expect(res.body.assessment.criteria.writing).toMatchObject({ score: 22, source: 'teacher' });
    expect(res.body.assessment.teacherReview.comment).toContain('paragraph links');
    expect((await api(ctx, teacher, 'PUT', `/api/teacher/assessments/${sid}/review`, { scores: { reading: 26 } })).status).toBe(400);
  });

  it('can re-run AI grading within the limit', async () => {
    const r = await api(ctx, teacher, 'POST', `/api/teacher/assessments/${sid}/regrade`);
    expect(r.body.status).toBe('graded');
    const res = await api(ctx, s1, 'GET', `/api/sessions/${sid}/results`);
    expect(res.body.assessment.teacherReview).not.toBeNull(); // review kept
  });

  it('exports results as CSV', async () => {
    const r = await api(ctx, teacher, 'GET', `/api/teacher/export.csv?courseId=${courseId}`);
    expect(r.raw.headers['content-type']).toContain('text/csv');
    expect(r.raw.body.split('\r\n')[0]).toContain('reading_25,evidence_25,critical_thinking_20,writing_30');
    expect(r.raw.body).toContain(s1.email);
  });

  it('the class leaderboard shows game points only', async () => {
    const r = await api(ctx, s2, 'GET', `/api/leaderboard?courseId=${courseId}`);
    expect(r.status).toBe(200);
    expect(r.body.rows[0].uid).toBe(s1.uid);
    const json = JSON.stringify(r.body);
    for (const k of ['percent', 'report', 'assessment', 'criteria']) expect(json).not.toContain(k);
    const outsider = await createUser(ctx.deps, tenantId, 'student');
    expect((await api(ctx, outsider, 'GET', `/api/leaderboard?courseId=${courseId}`)).status).toBe(403);
  });

  it('LMS evidence uses the common K26 format', async () => {
    const r = await api(ctx, admin, 'GET', `/api/lms/v1/results?courseId=${courseId}`);
    expect(r.body.items[0]).toMatchObject({
      schema: 'k26-evidence-1.0',
      source: 'english-detective',
      activity: { type: 'investigation_case', id: 'CASE01' },
      skills: ['reading', 'writing', 'critical_thinking'],
      result: { scoreType: 'teacher_validated', completed: true },
    });
  });
});

describe('case bank management', () => {
  it('drafts are hidden from students until approved; inconsistent drafts cannot be approved', async () => {
    const t = await createTenant(ctx.deps, { approve: false });
    const a = await createUser(ctx.deps, t.id, 'school_admin');
    const tch = await createUser(ctx.deps, t.id, 'teacher');
    const st = await createUser(ctx.deps, t.id, 'student');
    expect((await api(ctx, st, 'GET', '/api/cases')).body.cases).toHaveLength(0);
    const list = await api(ctx, tch, 'GET', '/api/admin/cases');
    expect(list.body.cases.every((c: any) => c.pendingApproval)).toBe(true);
    expect((await api(ctx, tch, 'POST', '/api/admin/cases/CASE01/approve', { version: 1 })).status).toBe(200);
    expect((await api(ctx, st, 'GET', '/api/cases')).body.cases.map((c: any) => c.id)).toEqual(['CASE01']);

    const broken = structuredClone(BUILTIN_CASES[0]!) as any;
    broken.evidence[0].excerpt = 'This sentence does not exist in the document body at all';
    const saved = await api(ctx, tch, 'PUT', '/api/admin/cases/CASE01', { dossier: broken, note: 'typo' });
    expect(saved.body.version).toBe(2);
    expect(saved.body.check.ok).toBe(false);
    const appr = await api(ctx, tch, 'POST', '/api/admin/cases/CASE01/approve', { version: 2 });
    expect(appr.status).toBe(400);
    expect(JSON.stringify(appr.body.error.details)).toContain('excerpt not found');
    expect((await api(ctx, a, 'POST', '/api/admin/cases/CASE01/archive', { archived: true })).status).toBe(200);
    expect((await api(ctx, st, 'GET', '/api/cases')).body.cases).toHaveLength(0);
  });

  it('the AI case generator creates a draft that teachers must approve', async () => {
    const r = await api(ctx, teacher, 'POST', '/api/admin/cases/generate', {
      caseId: 'CASE07', topic: 'Fake reviews for a campus café', level: 'B1', learningObjectives: 'Evaluate online reviews and write a short report.', documentCount: 5, characterCount: 3, minutes: 25, writingType: 'report',
    });
    expect(r.status).toBe(200);
    expect(r.body.check.ok).toBe(true);
    const c = await api(ctx, teacher, 'GET', '/api/admin/cases/CASE07');
    expect(c.body.case.status).toBe('draft');
    expect(c.body.versions[0].source).toBe('ai_generated');
    expect((await api(ctx, s1, 'GET', '/api/cases')).body.cases.map((x: any) => x.id)).not.toContain('CASE07');
    expect((await api(ctx, teacher, 'POST', '/api/admin/cases/generate', { caseId: 'CASE07', topic: 'Again', level: 'B1', learningObjectives: 'x x x x x', documentCount: 5, characterCount: 3, minutes: 25, writingType: 'report' })).status).toBe(409);
  });
});

describe('school administration', () => {
  it('creates users and courses, imports CSV, updates quotas and shows usage', async () => {
    const u = await api(ctx, admin, 'POST', '/api/admin/users', { email: `gv-${uuid().slice(0, 6)}@test.edu.vn`, displayName: 'Thầy Minh', role: 'teacher' });
    expect(u.body.temporaryPassword).toBeTruthy();
    const c = await api(ctx, admin, 'POST', '/api/admin/courses', { code: 'ENG301', name: 'Academic Writing', teacherIds: [u.body.uid], studentIds: [s1.uid] });
    expect(c.status).toBe(200);
    const imp = await api(ctx, admin, 'POST', '/api/admin/users/import', { csv: `email,displayName,role,studentCode,courseCode,password\nsv-${uuid().slice(0, 6)}@test.edu.vn,Nguyễn An,student,SV9,ENG301,Password-123\nbad,,,,,` });
    expect(imp.body.imported).toBe(1);
    expect(imp.body.errors).toHaveLength(1);
    const s = await api(ctx, admin, 'GET', '/api/admin/settings');
    expect((await api(ctx, admin, 'PUT', '/api/admin/quotas', { ...s.body.quotas, interviewQuestionsPerSession: 30 })).status).toBe(200);
    expect((await api(ctx, admin, 'PUT', '/api/admin/ai-config', { ...s.body.aiConfig, temperature: 0.5 })).status).toBe(200);
    const usage = await api(ctx, admin, 'GET', '/api/admin/usage');
    expect(usage.body.byKind.character.calls).toBeGreaterThan(0);
    expect(usage.body.byKind.grade.calls).toBeGreaterThan(0);
    const audit = await api(ctx, admin, 'GET', '/api/admin/audit-logs');
    expect(audit.body.logs.map((l: any) => l.action)).toEqual(expect.arrayContaining(['user.create', 'course.create', 'settings.quotas', 'case.generate', 'assessment.review']));
    expect((await api(ctx, admin, 'POST', '/api/admin/health/ai')).body.ok).toBe(true);
  });

  it('deletes a student\'s data on request', async () => {
    const u = await createUser(ctx.deps, tenantId, 'student');
    const id = await playViaApi(ctx, u, getBuiltinCase('CASE01')!);
    await api(ctx, u, 'GET', `/api/sessions/${id}/results`);
    const r = await api(ctx, admin, 'DELETE', `/api/admin/users/${u.uid}`);
    expect(r.body.sessions).toBe(1);
    expect((await api(ctx, admin, 'GET', `/api/teacher/sessions/${id}`)).status).toBe(404);
    await expect(signIn(u.email)).rejects.toThrow();
  });
});

describe('platform', () => {
  it('creates a school with draft cases and a school admin', async () => {
    const p = await createPlatformAdmin(ctx.deps);
    const id = `uni-${uuid().slice(0, 6)}`;
    const r = await api(ctx, p, 'POST', '/api/platform/tenants', { id, name: 'Trường Thử nghiệm', adminEmail: `admin@${id}.edu.vn`, adminName: 'Admin' });
    expect(r.status).toBe(200);
    const token = await signIn(`admin@${id}.edu.vn`, r.body.admin.temporaryPassword);
    const cases = await api(ctx, { uid: r.body.admin.uid, email: '', token }, 'GET', '/api/admin/cases');
    expect(cases.body.cases).toHaveLength(BUILTIN_CASES.length);
  });
});
