import { beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_CASES, getBuiltinCase } from '@ed/game-engine';
import { api, createTenant, createUser, makeApp, uuid, type TestCtx, type TestUser } from '../helpers.js';
import { playViaApi } from '../play-api.js';

let ctx: TestCtx;
let student: TestUser;

beforeAll(async () => {
  ctx = await makeApp();
  const t = await createTenant(ctx.deps);
  student = await createUser(ctx.deps, t.id, 'student');
});

describe('case bank', () => {
  it('lists the six approved cases without hidden data', async () => {
    const r = await api(ctx, student, 'GET', '/api/cases');
    expect(r.body.cases.map((c: any) => c.id)).toEqual(['CASE01', 'CASE02', 'CASE03', 'CASE04', 'CASE05', 'CASE06']);
    const detail = await api(ctx, student, 'GET', '/api/cases/CASE01');
    const json = JSON.stringify([r.body, detail.body]);
    for (const k of ['sampleSolution', 'correctOptionId', 'evidence', 'facts', 'keyPoints', 'acceptable', 'explanation']) expect(json).not.toContain(`"${k}":`);
  });
});

describe('investigation flow', () => {
  it.each(BUILTIN_CASES.map((c) => c.id))('%s can be solved, submitted and graded', async (caseId) => {
    const d = getBuiltinCase(caseId)!;
    const sid = await playViaApi(ctx, student, d);
    const r = await api(ctx, student, 'GET', `/api/sessions/${sid}/results`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('graded');
    const a = r.body.assessment;
    expect(a.solved).toBe(true);
    expect(a.criteria.evidence.score).toBeGreaterThanOrEqual(22);
    expect(a.criteria.reading.score).toBeGreaterThanOrEqual(20);
    expect(a.criteria.criticalThinking.status).toBe('assessed');
    expect(a.criteria.writing.status).toBe('assessed');
    expect(a.aiStatus).toBe('ok');
    // The grader's invented correction (not in the report) was removed by the quote check.
    expect(a.feedback.corrections).toEqual([]);
    expect(a.qualityChecks.removedUnverifiableQuotes).toBeGreaterThanOrEqual(1);
    expect(r.body.solution.conclusion).toBe(d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text);
    expect(a.disclaimer).toMatch(/not an official score/);
  });

  it('awards game points, badges and the next case', async () => {
    const r = await api(ctx, student, 'GET', '/api/student/progress');
    expect(r.body.stats.casesSolved).toBe(6);
    expect(r.body.stats.detectivePoints).toBeGreaterThan(600);
    expect(r.body.achievements).toEqual(expect.arrayContaining(['first_case', 'sharp_eye', 'interviewer', 'b2_detective', 'master_detective']));
  });

  it('interviews unlock documents only through eligible facts', async () => {
    const d = getBuiltinCase('CASE01')!;
    const start = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE01', restart: true });
    const sid = start.body.session.id;
    const locked = start.body.investigation.documents.find((x: any) => x.id === 'd_it_report');
    expect(locked.locked).toBe(true);
    expect(locked.body).toBe('');
    expect((await api(ctx, student, 'POST', `/api/sessions/${sid}/highlights`, { documentId: 'd_it_report', text: d.evidence.find((e) => e.id === 'ev_domain_registered')!.excerpt })).body.error.code).toBe('LOCKED');
    const r = await api(ctx, student, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: 'anna', question: 'Did anyone check this email?' });
    expect(r.status).toBe(200);
    expect(r.body.message.unlockedDocumentIds).toEqual(['d_it_report']);
    expect(r.body.investigation.documents.find((x: any) => x.id === 'd_it_report').locked).toBe(false);
  });

  it('wrong conclusion is graded as not solved, with partial critical thinking', async () => {
    const d = getBuiltinCase('CASE01')!;
    const sid = await playViaApi(ctx, student, d, { submit: false });
    const c = await api(ctx, student, 'POST', `/api/sessions/${sid}/conclusion`, { optionId: 'c_genuine', supportingEvidenceIds: ['ev_logo_claim', 'ev_fee', 'ev_committee_date'], justification: 'The logo looks real and the committee chooses winners, so it is genuine.' });
    expect(c.status).toBe(200);
    // Citing evidence that was never collected is refused.
    expect((await api(ctx, student, 'POST', `/api/sessions/${sid}/conclusion`, { optionId: 'c_genuine', supportingEvidenceIds: ['ev_amount'], justification: 'Only the amount matters here.' })).status).toBe(400);
    const view = await api(ctx, student, 'GET', `/api/sessions/${sid}`);
    await api(ctx, student, 'POST', `/api/sessions/${sid}/submit`, { text: d.sampleSolution.report, draftVersion: view.body.draft.version });
    const r = await api(ctx, student, 'GET', `/api/sessions/${sid}/results`);
    expect(r.body.assessment.solved).toBe(false);
    expect(r.body.assessment.conclusion.correct).toBe(false);
    expect(r.body.assessment.criteria.criticalThinking.score).toBeLessThan(10);
    expect(r.body.assessment.recommendation.nextCaseId).toBe('CASE01');
  });

  it('cannot submit before the investigation is complete', async () => {
    const start = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE02', restart: true });
    const r = await api(ctx, student, 'POST', `/api/sessions/${start.body.session.id}/submit`, { text: 'My report.', draftVersion: 0 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_READY_TO_SUBMIT');
    expect(r.body.error.details.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it('hints come in three levels per stage and are recorded', async () => {
    const start = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE03', restart: true });
    const sid = start.body.session.id;
    for (let i = 1; i <= 3; i++) expect((await api(ctx, student, 'POST', `/api/sessions/${sid}/hint`, { stage: 'evidence' })).body.result.level).toBe(i);
    const r = await api(ctx, student, 'POST', `/api/sessions/${sid}/hint`, { stage: 'evidence' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('HINT_LIMIT');
  });

  it('highlights that match no evidence become personal clues', async () => {
    const start = await api(ctx, student, 'POST', '/api/sessions', { caseId: 'CASE01', restart: true });
    const sid = start.body.session.id;
    const r = await api(ctx, student, 'POST', `/api/sessions/${sid}/highlights`, { documentId: 'd_scam_email', text: 'Bank: Global Trust Bank' });
    expect(r.body.result.kind).toBe('clue');
    expect(r.body.investigation.clues).toHaveLength(1);
    const bad = await api(ctx, student, 'POST', `/api/sessions/${sid}/highlights`, { documentId: 'd_scam_email', text: 'This text is not in the email at all' });
    expect(bad.status).toBe(400);
  });
});
