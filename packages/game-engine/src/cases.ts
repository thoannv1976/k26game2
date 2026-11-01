import { CaseDossierSchema, type CaseDossier } from '@ed/shared';
import CASE01 from '../../../content/cases/CASE01.json';
import CASE02 from '../../../content/cases/CASE02.json';
import CASE03 from '../../../content/cases/CASE03.json';
import CASE04 from '../../../content/cases/CASE04.json';
import CASE05 from '../../../content/cases/CASE05.json';
import CASE06 from '../../../content/cases/CASE06.json';

/**
 * Built-in case bank (v1.0). Seed content: at runtime the API serves cases from Firestore
 * (tenants/{t}/cases/{id}/versions/{n}), where teachers can edit and must approve them.
 */
export const BUILTIN_CASES: CaseDossier[] = [CASE01, CASE02, CASE03, CASE04, CASE05, CASE06].map((c) => CaseDossierSchema.parse(c));

export function getBuiltinCase(id: string): CaseDossier | undefined {
  return BUILTIN_CASES.find((c) => c.id === id);
}
