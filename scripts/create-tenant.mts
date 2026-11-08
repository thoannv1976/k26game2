/**
 * Creates a school (tenant) that is used through the LMS (UniGame Hub / LTI): no admin account is created,
 * teachers and students are provisioned on their first launch from Moodle.
 * Use the SAME tenant id as in English City Simulator (Game 1): Firebase Auth claims {tenantId, role} are shared.
 *
 *   npx tsx scripts/create-tenant.mts --project k26game1 --tenant aiedu2026 --name "AIEdu2026" [--approve] [--database detective]
 *
 * --approve  publishes the built-in cases (CASE01–06) so LMS activities can use them right away
 *            (otherwise a teacher or school admin must approve them in Admin → Cases).
 * Idempotent: an existing tenant or case is left unchanged.
 * Requires Application Default Credentials with Firestore access to --project.
 */
import { parseArgs } from 'node:util';
import { DEFAULT_AI_CONFIG, DEFAULT_QUOTAS, type TenantDoc } from '@ed/shared';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    database: { type: 'string', default: 'detective' },
    tenant: { type: 'string' },
    name: { type: 'string' },
    approve: { type: 'boolean', default: false },
  },
});
if (!values.project || !values.tenant || !values.name || !/^[a-z0-9-]{3,40}$/.test(values.tenant)) {
  console.error('Usage: --project <id> --tenant <a-z0-9-> --name "<School name>" [--approve] [--database detective]');
  process.exit(1);
}
process.env.GCP_PROJECT_ID = values.project;
process.env.FIRESTORE_DATABASE = values.database;

const { loadConfig } = await import('../apps/api/src/config.js');
const { createDeps } = await import('../apps/api/src/deps.js');
const { paths } = await import('../apps/api/src/paths.js');
const { seedBuiltinCases } = await import('../apps/api/src/services/cases.js');

const deps = createDeps(loadConfig({ env: 'development', aiProvider: 'fake', ltiEnabled: false }));
const ref = paths(deps.db).tenant(values.tenant);
if (!(await ref.get()).exists) {
  const t: TenantDoc = {
    id: values.tenant,
    name: values.name,
    allowedEmailDomains: [],
    quotas: DEFAULT_QUOTAS,
    aiConfig: DEFAULT_AI_CONFIG,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await ref.set(t);
  console.log(`Created school ${t.id} – ${t.name} (database "${values.database}")`);
} else {
  console.log(`School ${values.tenant} already exists (unchanged)`);
}
const seeded = await seedBuiltinCases(deps, values.tenant, values.approve ? { approvedBy: 'lti-setup' } : {});
console.log(`Cases seeded: ${seeded.created} (${values.approve ? 'approved' : 'draft'})`);
process.exit(0);
