import type { Firestore } from 'firebase-admin/firestore';

/** Firestore layout (see docs/DATABASE.md). All learning data lives under tenants/{tenantId}. */
export const paths = (db: Firestore) => ({
  tenant: (t: string) => db.collection('tenants').doc(t),
  tenants: () => db.collection('tenants'),
  users: (t: string) => db.collection(`tenants/${t}/users`),
  user: (t: string, uid: string) => db.doc(`tenants/${t}/users/${uid}`),
  courses: (t: string) => db.collection(`tenants/${t}/courses`),
  course: (t: string, id: string) => db.doc(`tenants/${t}/courses/${id}`),
  assignments: (t: string) => db.collection(`tenants/${t}/assignments`),
  cases: (t: string) => db.collection(`tenants/${t}/cases`),
  case: (t: string, id: string) => db.doc(`tenants/${t}/cases/${id}`),
  caseVersions: (t: string, id: string) => db.collection(`tenants/${t}/cases/${id}/versions`),
  caseVersion: (t: string, id: string, v: number) => db.doc(`tenants/${t}/cases/${id}/versions/${v}`),
  sessions: (t: string) => db.collection(`tenants/${t}/investigation_sessions`),
  session: (t: string, id: string) => db.doc(`tenants/${t}/investigation_sessions/${id}`),
  messages: (t: string, sid: string) => db.collection(`tenants/${t}/investigation_sessions/${sid}/interview_messages`),
  message: (t: string, sid: string, id: string) => db.doc(`tenants/${t}/investigation_sessions/${sid}/interview_messages/${id}`),
  assistantMessages: (t: string, sid: string) => db.collection(`tenants/${t}/investigation_sessions/${sid}/assistant_messages`),
  assistantMessage: (t: string, sid: string, id: string) => db.doc(`tenants/${t}/investigation_sessions/${sid}/assistant_messages/${id}`),
  notebook: (t: string, sid: string) => db.doc(`tenants/${t}/investigation_sessions/${sid}/investigation_notes/notebook`),
  draft: (t: string, sid: string) => db.doc(`tenants/${t}/investigation_sessions/${sid}/drafts/current`),
  reports: (t: string) => db.collection(`tenants/${t}/final_reports`),
  report: (t: string, sid: string) => db.doc(`tenants/${t}/final_reports/${sid}`),
  assessments: (t: string) => db.collection(`tenants/${t}/assessments`),
  assessment: (t: string, sid: string) => db.doc(`tenants/${t}/assessments/${sid}`),
  counters: (t: string) => db.collection(`tenants/${t}/usage_counters`),
  counter: (t: string, id: string) => db.doc(`tenants/${t}/usage_counters/${id}`),
  usageLogs: (t: string) => db.collection(`tenants/${t}/usage_logs`),
  auditLogs: (t: string) => db.collection(`tenants/${t}/audit_logs`),
  platformAudit: () => db.collection('platform_audit_logs'),
});
export type Paths = ReturnType<typeof paths>;
