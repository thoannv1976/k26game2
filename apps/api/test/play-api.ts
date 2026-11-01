import type { CaseDossier } from '@ed/shared';
import { api, uuid, type TestCtx, type TestUser } from './helpers.js';

/** Plays a case through the HTTP API with its sample solution (offline AI). Returns the session id. */
export async function playViaApi(ctx: TestCtx, user: TestUser, d: CaseDossier, opts: { submit?: boolean; restart?: boolean } = {}) {
  const ok = (r: { status: number; body: any }, what: string) => {
    if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const start = ok(await api(ctx, user, 'POST', '/api/sessions', { caseId: d.id, restart: opts.restart ?? true }), 'start');
  const sid = start.session.id as string;
  ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/briefing`), 'briefing');
  for (const doc of start.investigation.documents.filter((x: any) => !x.locked)) ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/documents/${doc.id}/open`), 'open');
  for (const iq of d.sampleSolution.interviewQuestions) {
    ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: iq.characterId, question: iq.question }), 'interview');
  }
  for (const c of d.characters) {
    if (!d.sampleSolution.interviewQuestions.some((q) => q.characterId === c.id)) {
      ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/interviews`, { clientMessageId: uuid(), characterId: c.id, question: 'Hello, can you tell me about your role here?' }), 'interview');
    }
  }
  for (let round = 0; round < 3; round++) {
    const v = ok(await api(ctx, user, 'GET', `/api/sessions/${sid}`), 'view');
    const unlocked = new Set(v.investigation.documents.filter((x: any) => !x.locked).map((x: any) => x.id));
    const have = new Set(v.investigation.evidence.map((e: any) => e.id));
    for (const h of d.sampleSolution.highlights) {
      if (have.has(h.evidenceId) || !unlocked.has(h.documentId)) continue;
      ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/highlights`, { documentId: h.documentId, text: h.text }), 'highlight');
    }
    const answered = new Set(v.investigation.questions.filter((q: any) => q.answer).map((q: any) => q.id));
    for (const q of v.investigation.questions) {
      if (answered.has(q.id)) continue;
      ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/answers`, { questionId: q.id, value: d.sampleSolution.answers[q.id] }), 'answer');
    }
  }
  const v = ok(await api(ctx, user, 'GET', `/api/sessions/${sid}`), 'view');
  const items = Object.fromEntries(v.investigation.evidence.map((e: any) => [e.id, { category: d.evidence.find((x) => x.id === e.id)!.category, note: 'Checked against the documents.' }]));
  const links = d.sampleSolution.links.map(({ a, b }) => ({ a, b, note: '' })).filter((l) => items[l.a] && items[l.b]);
  ok(await api(ctx, user, 'PUT', `/api/sessions/${sid}/board`, { items, links }), 'board');
  ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/conclusion`, d.sampleSolution.conclusion), 'conclusion');
  const draft = ok(await api(ctx, user, 'PUT', `/api/sessions/${sid}/draft`, { text: d.sampleSolution.report, baseVersion: 0 }), 'draft');
  if (opts.submit !== false) {
    ok(await api(ctx, user, 'POST', `/api/sessions/${sid}/submit`, { text: d.sampleSolution.report, draftVersion: draft.draft.version }), 'submit');
  }
  return sid;
}
