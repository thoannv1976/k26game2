import { BUILTIN_CASES, checkDossier } from '@ed/game-engine';
import { CaseRequestSchema, type CaseRequest } from '@ed/ai';
import { CaseDossierSchema, type CaseDoc, type CaseVersionDoc } from '@ed/shared';
import type { Member } from '../auth.js';
import type { Deps } from '../deps.js';
import { ApiError, notFound } from '../errors.js';
import { paths } from '../paths.js';
import { recordUsage, reserveAiCall } from '../quota.js';
import { getTenant } from '../tenants.js';
import { withRetry } from './retry.js';

/** Seeds the built-in case bank. Drafts unless `approvedBy` is given (content already reviewed). */
export async function seedBuiltinCases(deps: Deps, tenantId: string, opts: { approvedBy?: string; overwrite?: boolean } = {}) {
  const p = paths(deps.db);
  const now = deps.now().toISOString();
  let created = 0;
  for (const d of BUILTIN_CASES) {
    const ref = p.case(tenantId, d.id);
    const prev = (await ref.get()).data() as CaseDoc | undefined;
    if (prev && !opts.overwrite) continue;
    const version = (prev?.latestVersion ?? 0) + 1;
    const approved = Boolean(opts.approvedBy);
    const v: CaseVersionDoc = { version, dossier: d, status: approved ? 'approved' : 'draft', source: 'builtin', createdBy: 'system:seed', createdAt: now, approvedBy: opts.approvedBy ?? null, approvedAt: approved ? now : null, note: 'Built-in content v1.0' };
    await p.caseVersion(tenantId, d.id, version).set(v);
    const doc: CaseDoc = {
      id: d.id,
      level: d.level,
      approvedVersion: approved ? version : (prev?.approvedVersion ?? 0),
      latestVersion: version,
      status: approved ? 'approved' : (prev?.status ?? 'draft'),
      title: approved ? d.title : (prev?.title ?? d.title),
      updatedAt: now,
    };
    await ref.set(doc);
    created++;
  }
  return { created };
}

export async function listCasesAdmin(deps: Deps, tenantId: string) {
  const snap = await paths(deps.db).cases(tenantId).get();
  return snap.docs
    .map((x) => x.data() as CaseDoc)
    .map((c) => ({ ...c, pendingApproval: c.latestVersion > c.approvedVersion }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function getCaseAdmin(deps: Deps, tenantId: string, id: string) {
  const p = paths(deps.db);
  const doc = (await p.case(tenantId, id).get()).data() as CaseDoc | undefined;
  if (!doc) throw notFound('Case');
  const versions = (await p.caseVersions(tenantId, id).orderBy('version', 'desc').limit(20).get()).docs.map((x) => {
    const v = x.data() as CaseVersionDoc;
    const check = checkDossier(v.dossier);
    return { ...v, check: { ok: check.ok, errors: check.errors, warnings: check.warnings } };
  });
  return { case: doc, versions };
}

async function writeDraft(deps: Deps, tenantId: string, id: string, dossier: unknown, actor: string, note: string, source: CaseVersionDoc['source']) {
  const parsed = CaseDossierSchema.safeParse(dossier);
  if (!parsed.success) {
    throw new ApiError('VALIDATION', 'Case content is invalid', parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (parsed.data.id !== id) throw new ApiError('VALIDATION', 'The case id in the content must match the URL');
  const p = paths(deps.db);
  return deps.db.runTransaction(async (tx) => {
    const ref = p.case(tenantId, id);
    const prev = (await tx.get(ref)).data() as CaseDoc | undefined;
    const version = (prev?.latestVersion ?? 0) + 1;
    const now = deps.now().toISOString();
    tx.set(p.caseVersion(tenantId, id, version), { version, dossier: parsed.data, status: 'draft', source, createdBy: actor, createdAt: now, approvedBy: null, approvedAt: null, note } satisfies CaseVersionDoc);
    tx.set(ref, {
      id,
      level: prev?.level ?? parsed.data.level,
      approvedVersion: prev?.approvedVersion ?? 0,
      latestVersion: version,
      status: prev?.status ?? 'draft',
      title: prev?.title ?? parsed.data.title,
      updatedAt: now,
    } satisfies CaseDoc);
    const check = checkDossier(parsed.data);
    return { version, check: { ok: check.ok, errors: check.errors, warnings: check.warnings } };
  });
}

export const saveCaseDraft = (deps: Deps, tenantId: string, id: string, dossier: unknown, actor: string, note: string) =>
  writeDraft(deps, tenantId, id, dossier, actor, note, 'teacher');

/** Approves a version. Only versions that pass all consistency checks can be published. */
export async function approveCase(deps: Deps, tenantId: string, id: string, version: number, actor: string) {
  const p = paths(deps.db);
  return deps.db.runTransaction(async (tx) => {
    const ref = p.case(tenantId, id);
    const vRef = p.caseVersion(tenantId, id, version);
    const [c, v] = await Promise.all([tx.get(ref), tx.get(vRef)]);
    if (!c.exists || !v.exists) throw notFound('Case version');
    const vd = v.data() as CaseVersionDoc;
    const check = checkDossier(vd.dossier);
    if (!check.ok) throw new ApiError('VALIDATION', 'This version has consistency errors and cannot be approved', check.errors.map((message) => ({ path: '', message })));
    const cd = c.data() as CaseDoc;
    const now = deps.now().toISOString();
    if (cd.approvedVersion && cd.approvedVersion !== version) tx.update(p.caseVersion(tenantId, id, cd.approvedVersion), { status: 'superseded' });
    tx.update(vRef, { status: 'approved', approvedBy: actor, approvedAt: now });
    tx.update(ref, { approvedVersion: version, status: 'approved', level: vd.dossier.level, title: vd.dossier.title, updatedAt: now });
    return { approvedVersion: version };
  });
}

export async function setCaseArchived(deps: Deps, tenantId: string, id: string, archived: boolean) {
  const ref = paths(deps.db).case(tenantId, id);
  const doc = (await ref.get()).data() as CaseDoc | undefined;
  if (!doc) throw notFound('Case');
  const status = archived ? 'archived' : doc.approvedVersion > 0 ? 'approved' : 'draft';
  await ref.update({ status, updatedAt: deps.now().toISOString() });
  return { status };
}

/**
 * AI Case Generator: drafts a complete dossier for teacher review.
 * The draft is validated by the same consistency checks; one automatic repair round is attempted.
 * It is never published without approval.
 */
export async function generateCase(deps: Deps, m: Member, input: CaseRequest) {
  const req = CaseRequestSchema.parse(input);
  const p = paths(deps.db);
  if ((await p.case(m.tenantId, req.caseId).get()).exists) throw new ApiError('CONFLICT', `${req.caseId} already exists – choose a new case id`);
  const tenant = await getTenant(deps, m.tenantId);
  await deps.db.runTransaction(async (tx) => {
    const q = await reserveAiCall(deps, tx, tenant, m.uid, null, null);
    q.commit();
  });
  const example = BUILTIN_CASES.find((c) => c.level === req.level) ?? BUILTIN_CASES[0]!;
  const model = deps.config.geminiModel ?? tenant.aiConfig.assessmentModel;
  let feedback: string[] | undefined;
  let last: unknown = null;
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const r = await withRetry(() => deps.ai.generateCase(req, example, model, feedback), { retries: 1, timeoutMs: 240_000 });
    void recordUsage(deps, tenant, { kind: 'generate', uid: m.uid, sessionId: null, courseId: null, model, ...r.usage, ok: true, latencyMs: Date.now() - started });
    last = { ...(r.output as object), id: req.caseId };
    const check = checkDossier(last);
    if (check.ok) return writeDraft(deps, m.tenantId, req.caseId, check.dossier, m.uid, `AI generated: ${req.topic}`, 'ai_generated');
    lastErrors = check.errors;
    feedback = check.errors;
  }
  // Keep a schema-valid draft for manual fixing; otherwise report the problems.
  if (CaseDossierSchema.safeParse(last).success) {
    return writeDraft(deps, m.tenantId, req.caseId, last, m.uid, `AI generated (needs fixes): ${req.topic}`, 'ai_generated');
  }
  throw new ApiError('VALIDATION', 'The AI could not produce a valid case. Try again or simplify the request.', lastErrors.slice(0, 30).map((message) => ({ path: '', message })));
}
