import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HINT_STAGES, LevelSchema, type AssignmentDoc, type CourseDoc, type TenantDoc, type UserDoc } from '@ed/shared';
import { EVIDENCE_CATEGORIES } from '@ed/shared';
import { publicCaseDetail, publicCaseSummary } from '@ed/game-engine';
import { parseBody } from '../app.js';
import { requireTenantMember } from '../auth.js';
import type { Deps } from '../deps.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { paths } from '../paths.js';
import { getTenant, getUserDoc, listApprovedCases } from '../tenants.js';
import { newUserDoc } from '../services/users.js';
import {
  acknowledge, answer, askAssistant, board, conclude, getInvestigation, highlight, hint, interview, openDoc,
  removeClue, saveDraft, saveNotebook, startInvestigation, submitReport,
} from '../services/investigation.js';
import { getResults } from '../services/grading.js';
import type { AssessmentDoc, SessionDoc } from '../types.js';

const Id = z.string().regex(/^[a-z0-9_]+$/).max(60);
const ClientId = z.string().uuid();

export async function coreRoutes(app: FastifyInstance, deps: Deps) {
  const p = paths(deps.db);
  const sid = (req: { params: unknown }) => (req.params as { id: string }).id;

  /* ---------------- me (accounts shared with English City Simulator) ---------------- */
  app.get('/api/me', async (req) => {
    const u = req.authUser!;
    if (u.role === 'platform_admin') return { user: { uid: u.uid, email: u.email, displayName: u.name, role: u.role, tenantId: null }, tenant: null };
    if (!u.role || !u.tenantId) {
      // Self-provisioning for allowed school e-mail domains (e.g. Google sign-in).
      const domain = u.email.split('@')[1]?.toLowerCase();
      if (domain) {
        const t = await p.tenants().where('allowedEmailDomains', 'array-contains', domain).limit(1).get();
        const tenant = t.docs[0]?.data() as TenantDoc | undefined;
        if (tenant?.active) {
          await deps.auth.setCustomUserClaims(u.uid, { tenantId: tenant.id, role: 'student' });
          const ref = p.user(tenant.id, u.uid);
          if (!(await ref.get()).exists) await ref.set(newUserDoc(u.uid, tenant.id, { email: u.email, displayName: u.name, role: 'student' }, deps.now()));
          return { refreshToken: true, user: null, tenant: null };
        }
      }
      throw new ApiError('NOT_PROVISIONED', 'Your account has not been added to a school yet. Please contact your teacher.');
    }
    const m = requireTenantMember(u);
    const tenantSnap = await p.tenant(m.tenantId).get();
    if (!tenantSnap.exists) throw new ApiError('NOT_PROVISIONED', 'Your school has not been set up in English Detective yet. Please contact the school administrator.');
    let user = await getUserDoc(deps, m.tenantId, m.uid);
    if (!user) {
      // Account created in English City Simulator (shared Firebase Auth): create the Detective profile on first visit.
      user = newUserDoc(m.uid, m.tenantId, { email: m.email, displayName: m.name, role: m.role as Exclude<UserDoc['role'], 'platform_admin'> }, deps.now());
      await p.user(m.tenantId, m.uid).set(user);
    }
    if (user.disabled) throw new ApiError('FORBIDDEN', 'This account is disabled');
    const tenant = tenantSnap.data() as TenantDoc;
    return { user, tenant: { id: tenant.id, name: tenant.name } };
  });

  app.patch('/api/me', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ locale: z.enum(['vi', 'en']).optional(), level: LevelSchema.optional(), displayName: z.string().trim().min(1).max(120).optional() }), req.body);
    await p.user(m.tenantId, m.uid).update(body);
    return { user: await getUserDoc(deps, m.tenantId, m.uid) };
  });

  /* ---------------- cases ---------------- */
  app.get('/api/cases', async (req) => {
    const m = requireTenantMember(req.authUser);
    const q = parseBody(z.object({ level: LevelSchema.optional() }), req.query);
    const [cases, user, active] = await Promise.all([
      listApprovedCases(deps, m.tenantId),
      getUserDoc(deps, m.tenantId, m.uid),
      p.sessions(m.tenantId).where('uid', '==', m.uid).where('status', '==', 'active').get(),
    ]);
    return {
      cases: cases
        .filter((c) => !q.level || c.dossier.level === q.level)
        .map(({ dossier }) => ({
          ...publicCaseSummary(dossier),
          solved: Boolean(user?.completedCaseIds?.includes(dossier.id)),
          bestPercent: user?.bestPercent?.[dossier.id] ?? null,
          activeSessionId: active.docs.find((d) => (d.data() as SessionDoc).caseId === dossier.id)?.id ?? null,
        })),
    };
  });

  app.get('/api/cases/:id', async (req) => {
    const m = requireTenantMember(req.authUser);
    const c = (await listApprovedCases(deps, m.tenantId)).find((x) => x.dossier.id === sid(req));
    if (!c) throw notFound('Case');
    const active = await p.sessions(m.tenantId).where('uid', '==', m.uid).where('caseId', '==', c.dossier.id).where('status', '==', 'active').limit(1).get();
    return { case: publicCaseDetail(c.dossier), activeSessionId: active.docs[0]?.id ?? null };
  });

  /* ---------------- investigation sessions ---------------- */
  app.post('/api/sessions', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ caseId: z.string().regex(/^CASE\d{2,3}$/), assignmentId: z.string().max(100).optional(), restart: z.boolean().optional() }), req.body);
    return startInvestigation(deps, m, body);
  });

  app.get('/api/sessions/:id', async (req) => getInvestigation(deps, requireTenantMember(req.authUser), sid(req)));

  app.get('/api/sessions/:id/documents', async (req) => {
    const v = await getInvestigation(deps, requireTenantMember(req.authUser), sid(req));
    return { documents: v.investigation.documents };
  });

  app.post('/api/sessions/:id/briefing', async (req) => (await acknowledge(deps, requireTenantMember(req.authUser), sid(req))).view);

  app.post('/api/sessions/:id/documents/:docId/open', async (req) => {
    const m = requireTenantMember(req.authUser);
    return (await openDoc(deps, m, sid(req), parseBody(Id, (req.params as { docId: string }).docId))).view;
  });

  app.post('/api/sessions/:id/answers', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ questionId: Id, value: z.union([z.number().int().min(0).max(10), z.string().trim().min(1).max(1500)]) }), req.body);
    const r = await answer(deps, m, sid(req), body.questionId, body.value);
    return { result: r.result, ...r.view };
  });

  app.post('/api/sessions/:id/highlights', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ documentId: Id, text: z.string().trim().min(3).max(1200) }), req.body);
    const r = await highlight(deps, m, sid(req), body.documentId, body.text);
    return { result: r.result, ...r.view };
  });

  app.delete('/api/sessions/:id/clues/:clueId', async (req) => {
    const m = requireTenantMember(req.authUser);
    return (await removeClue(deps, m, sid(req), (req.params as { clueId: string }).clueId)).view;
  });

  /** Spec: POST /sessions/:id/evidence – categorize evidence and links on the Case Board. */
  const boardHandler = async (req: { authUser?: unknown; params: unknown; body: unknown }) => {
    const m = requireTenantMember(req.authUser as never);
    const body = parseBody(
      z.object({
        items: z.record(Id, z.object({ category: z.enum(EVIDENCE_CATEGORIES).nullable(), note: z.string().max(600).default('') })).default({}),
        links: z.array(z.object({ a: Id, b: Id, note: z.string().max(300).default('') })).max(40).default([]),
      }),
      req.body,
    );
    return (await board(deps, m, sid(req), body)).view;
  };
  app.put('/api/sessions/:id/board', boardHandler);
  app.post('/api/sessions/:id/evidence', boardHandler);

  app.post('/api/sessions/:id/conclusion', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ optionId: Id, supportingEvidenceIds: z.array(Id).min(1).max(20), justification: z.string().trim().min(10).max(1500) }), req.body);
    return (await conclude(deps, m, sid(req), body)).view;
  });

  app.post('/api/sessions/:id/hint', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ stage: z.enum(HINT_STAGES) }), req.body);
    const r = await hint(deps, m, sid(req), body.stage);
    return { result: r.result, ...r.view };
  });

  app.post('/api/sessions/:id/interviews', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ clientMessageId: ClientId, characterId: Id, question: z.string().trim().min(3).max(500) }), req.body);
    return interview(deps, m, sid(req), body);
  });

  app.post('/api/sessions/:id/assistant', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ clientMessageId: ClientId, stage: z.string().max(30).default('general'), question: z.string().trim().min(3).max(500) }), req.body);
    return askAssistant(deps, m, sid(req), body);
  });

  app.put('/api/sessions/:id/notes', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ text: z.string().max(20000) }), req.body);
    return { notebook: await saveNotebook(deps, m, sid(req), body.text) };
  });

  app.put('/api/sessions/:id/draft', async (req) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ text: z.string().max(12000), baseVersion: z.number().int().min(0) }), req.body);
    return { draft: await saveDraft(deps, m, sid(req), body.text, body.baseVersion) };
  });

  app.post('/api/sessions/:id/submit', async (req, reply) => {
    const m = requireTenantMember(req.authUser);
    const body = parseBody(z.object({ text: z.string().trim().min(1).max(12000), draftVersion: z.number().int().min(0) }), req.body);
    const r = await submitReport(deps, m, sid(req), body);
    return reply.status(202).send(r);
  });

  /** Returns grading status and, once graded, the results. Triggers grading if needed (asynchronous). */
  app.get('/api/sessions/:id/results', async (req) => getResults(deps, requireTenantMember(req.authUser), sid(req)));

  /* ---------------- student dashboard & leaderboard ---------------- */
  app.get('/api/student/progress', async (req) => {
    const m = requireTenantMember(req.authUser);
    const user = await getUserDoc(deps, m.tenantId, m.uid);
    if (!user) throw notFound('User');
    const [assessSnap, activeSnap, cases] = await Promise.all([
      p.assessments(m.tenantId).where('uid', '==', m.uid).orderBy('createdAt', 'desc').limit(20).get(),
      p.sessions(m.tenantId).where('uid', '==', m.uid).where('status', 'in', ['active', 'submitted', 'grading']).limit(10).get(),
      listApprovedCases(deps, m.tenantId),
    ]);
    const recent = assessSnap.docs.map((d) => d.data() as AssessmentDoc);
    const titleOf = (id: string) => cases.find((c) => c.dossier.id === id)?.dossier.title ?? { en: id, vi: id };
    let assignments: (AssignmentDoc & { courseName: string; solved: boolean })[] = [];
    if (user.courseIds.length) {
      const courses = (await Promise.all(user.courseIds.slice(0, 30).map((c) => p.course(m.tenantId, c).get()))).map((s) => s.data() as CourseDoc | undefined).filter(Boolean) as CourseDoc[];
      if (courses.length) {
        const aSnap = await p.assignments(m.tenantId).where('courseId', 'in', courses.map((c) => c.id)).get();
        assignments = aSnap.docs.map((d) => {
          const a = d.data() as AssignmentDoc;
          return { ...a, courseName: courses.find((c) => c.id === a.courseId)?.name ?? '', solved: user.completedCaseIds.includes(a.caseId) };
        });
      }
    }
    return {
      user,
      stats: {
        xp: user.xp,
        detectivePoints: user.detectivePoints ?? 0,
        level: user.level,
        casesSolved: user.completedCaseIds.length,
        casesTotal: cases.length,
        reports: recent.length,
        averagePercent: recent.length ? Math.round(recent.reduce((s, a) => s + a.finalPercent, 0) / recent.length) : null,
      },
      achievements: user.achievements,
      recent: recent.map((a) => ({ sessionId: a.sessionId, caseId: a.caseId, title: titleOf(a.caseId), level: a.level, solved: a.solved, percent: a.finalPercent, reviewed: Boolean(a.teacherReview), createdAt: a.createdAt })),
      recommendation: recent[0] ? { ...recent[0].recommendation, title: recent[0].recommendation.nextCaseId ? titleOf(recent[0].recommendation.nextCaseId) : null, tips: recent[0].feedback?.recommendations.readingSkills ?? [] } : null,
      activeSessions: activeSnap.docs.map((d) => {
        const s = d.data() as SessionDoc;
        return { id: s.id, caseId: s.caseId, title: titleOf(s.caseId), status: s.status, lastActivityAt: s.lastActivityAt };
      }),
      assignments,
    };
  });

  /**
   * Class leaderboard: game points and badges only – never report texts or assessment scores (spec V.3).
   * Visible to members of the course and its teachers.
   */
  app.get('/api/leaderboard', async (req) => {
    const m = requireTenantMember(req.authUser);
    const q = parseBody(z.object({ courseId: z.string().min(1) }), req.query);
    const c = (await p.course(m.tenantId, q.courseId).get()).data() as CourseDoc | undefined;
    if (!c) throw notFound('Course');
    if (!c.studentIds.includes(m.uid) && !c.teacherIds.includes(m.uid) && m.role !== 'school_admin') throw forbidden();
    const snaps = c.studentIds.length ? await deps.db.getAll(...c.studentIds.map((u) => p.user(m.tenantId, u))) : [];
    const rows = snaps
      .map((s) => s.data() as UserDoc | undefined)
      .filter((u): u is UserDoc => Boolean(u))
      .map((u) => ({ uid: u.uid, displayName: u.displayName, detectivePoints: u.detectivePoints ?? 0, xp: u.xp ?? 0, casesSolved: u.completedCaseIds?.length ?? 0, badges: u.achievements?.length ?? 0, isMe: u.uid === m.uid }))
      .sort((a, b) => b.detectivePoints - a.detectivePoints || b.xp - a.xp);
    return { course: { id: c.id, code: c.code, name: c.name }, rows: rows.map((r, i) => ({ rank: i + 1, ...r })) };
  });

  app.get('/api/student/courses', async (req) => {
    const m = requireTenantMember(req.authUser);
    const user = await getUserDoc(deps, m.tenantId, m.uid);
    const ids = user?.courseIds ?? [];
    const snaps = ids.length ? await deps.db.getAll(...ids.map((id) => p.course(m.tenantId, id))) : [];
    return { courses: snaps.filter((s) => s.exists).map((s) => ({ id: s.id, code: (s.data() as CourseDoc).code, name: (s.data() as CourseDoc).name })) };
  });

  // Unused-variable guard for tenant fetch in some flows.
  void getTenant;
}
