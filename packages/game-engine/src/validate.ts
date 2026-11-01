/**
 * Consistency checks for a Canonical Case Dossier (beyond the zod schema).
 * Used by content tests, the admin editor and the AI Case Generator before a draft can be approved.
 */
import { CaseDossierSchema, type CaseDossier, type Unlock } from '@ed/shared';
import { containsPhrase, normalizeText, wordCount } from './text.js';
import { matchHighlight } from './state.js';

export interface DossierCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function checkDossier(input: unknown): DossierCheck & { dossier?: CaseDossier } {
  const parsed = CaseDossierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), warnings: [] };
  }
  const d = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const dup = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`Duplicate ${label} id "${id}"`);
      seen.add(id);
    }
  };
  const docIds = new Set(d.documents.map((x) => x.id));
  const qIds = new Set(d.questions.map((x) => x.id));
  const evIds = new Set(d.evidence.map((x) => x.id));
  const charIds = new Set(d.characters.map((x) => x.id));
  const facts = d.characters.flatMap((c) => c.facts.map((f) => ({ ...f, characterId: c.id })));
  const factIds = new Set(facts.map((f) => f.id));
  dup('document', d.documents.map((x) => x.id));
  dup('question', d.questions.map((x) => x.id));
  dup('evidence', d.evidence.map((x) => x.id));
  dup('character', d.characters.map((x) => x.id));
  dup('fact', facts.map((f) => f.id));

  const checkUnlock = (where: string, u: Unlock) => {
    if (u.type === 'fact' && !factIds.has(u.factId)) errors.push(`${where}: unknown fact "${u.factId}"`);
    if (u.type === 'question' && !qIds.has(u.questionId)) errors.push(`${where}: unknown question "${u.questionId}"`);
    if (u.type === 'evidence' && !evIds.has(u.evidenceId)) errors.push(`${where}: unknown evidence "${u.evidenceId}"`);
  };

  // Documents
  if (!d.documents.some((x) => x.unlock.type === 'start')) errors.push('At least one document must be available from the start');
  for (const doc of d.documents) checkUnlock(`document ${doc.id}`, doc.unlock);
  for (const doc of d.documents) {
    if (doc.unlock.type === 'fact' && !facts.some((f) => f.id === (doc.unlock as { factId: string }).factId && f.unlocksDocumentId === doc.id)) {
      warnings.push(`document ${doc.id} unlocks by fact but the fact does not declare unlocksDocumentId`);
    }
  }

  // Questions
  for (const q of d.questions) {
    for (const id of q.documentIds) if (!docIds.has(id)) errors.push(`question ${q.id}: unknown document "${id}"`);
    if (q.type === 'mcq' && q.correctIndex >= q.options.length) errors.push(`question ${q.id}: correctIndex out of range`);
  }
  if (!d.questions.some((q) => q.type === 'explain')) warnings.push('No explain question – reading will be fully machine-scored');

  // Evidence
  for (const ev of d.evidence) {
    const doc = d.documents.find((x) => x.id === ev.documentId);
    if (!doc) {
      errors.push(`evidence ${ev.id}: unknown document "${ev.documentId}"`);
      continue;
    }
    if (!normalizeText(doc.body).includes(normalizeText(ev.excerpt))) errors.push(`evidence ${ev.id}: excerpt not found in document ${doc.id}`);
    const words = wordCount(ev.excerpt);
    if (words < 3 || words > 40) errors.push(`evidence ${ev.id}: excerpt must be 3–40 words (has ${words})`);
    if (ev.key && ev.category === 'irrelevant') errors.push(`evidence ${ev.id}: key evidence cannot be irrelevant`);
    // Excerpts in the same document must not overlap (highlight matching would be ambiguous).
    for (const other of d.evidence) {
      if (other.id < ev.id && other.documentId === ev.documentId) {
        const a = normalizeText(ev.excerpt);
        const b = normalizeText(other.excerpt);
        if (a.includes(b) || b.includes(a)) errors.push(`evidence ${ev.id} and ${other.id} overlap`);
      }
    }
  }
  const keyCount = d.evidence.filter((e) => e.key).length;
  if (keyCount < 3) errors.push('Need at least 3 key evidence items');
  if (!d.evidence.some((e) => e.category === 'irrelevant')) errors.push('Need at least one distractor (irrelevant) evidence item');
  if (!d.evidence.some((e) => e.category === 'unverified')) warnings.push('No unverified evidence – categorization is less challenging');
  if (d.limits.minEvidenceToSubmit > d.evidence.length) errors.push('minEvidenceToSubmit is larger than the evidence list');
  for (const l of d.links) if (!evIds.has(l.a) || !evIds.has(l.b) || l.a === l.b) errors.push(`link ${l.a}-${l.b}: invalid evidence ids`);

  // Characters
  for (const c of d.characters) {
    for (const f of c.facts) {
      checkUnlock(`fact ${f.id}`, f.condition);
      if (f.unlocksDocumentId && !docIds.has(f.unlocksDocumentId)) errors.push(`fact ${f.id}: unknown document "${f.unlocksDocumentId}"`);
    }
    for (const r of c.restricted) {
      for (const phrase of r.forbiddenPhrases) {
        for (const f of c.facts) if (containsPhrase(f.text, phrase)) errors.push(`character ${c.id}: fact ${f.id} contains forbidden phrase "${phrase}"`);
      }
    }
  }

  // Conclusion
  const optIds = new Set(d.conclusion.options.map((o) => o.id));
  if (!optIds.has(d.conclusion.correctOptionId)) errors.push('conclusion.correctOptionId is not an option');
  for (const id of d.conclusion.requiredEvidenceIds) {
    const ev = d.evidence.find((e) => e.id === id);
    if (!ev) errors.push(`conclusion: unknown required evidence "${id}"`);
    else if (!ev.key) errors.push(`conclusion: required evidence "${id}" must be key evidence`);
  }
  if (d.conclusion.minSupporting > keyCount) errors.push('conclusion.minSupporting is larger than the number of key evidence items');

  // Writing
  if (d.writingTask.minWords >= d.writingTask.maxWords) errors.push('writingTask.minWords must be less than maxWords');

  // Reachability: every document must become unlockable by following the sample solution.
  const s = d.sampleSolution;
  for (const h of s.highlights) {
    if (!evIds.has(h.evidenceId)) errors.push(`sample highlight: unknown evidence "${h.evidenceId}"`);
    const m = matchHighlight(d, h.documentId, h.text);
    if (!m.inDocument) errors.push(`sample highlight "${h.text.slice(0, 40)}…" not found in ${h.documentId}`);
    else if (m.evidenceId !== h.evidenceId) errors.push(`sample highlight for ${h.evidenceId} matched ${m.evidenceId ?? 'nothing'}`);
  }
  for (const k of d.evidence.filter((e) => e.key)) {
    if (!s.highlights.some((h) => h.evidenceId === k.id)) errors.push(`sample solution does not collect key evidence ${k.id}`);
  }
  for (const q of d.questions) if (!(q.id in s.answers)) errors.push(`sample solution has no answer for ${q.id}`);
  for (const iq of s.interviewQuestions) {
    if (!charIds.has(iq.characterId)) errors.push(`sample interview: unknown character "${iq.characterId}"`);
    for (const f of iq.expectFactIds) if (!factIds.has(f)) errors.push(`sample interview: unknown fact "${f}"`);
  }
  if (s.conclusion.optionId !== d.conclusion.correctOptionId) errors.push('sample conclusion is not the correct option');
  for (const id of d.conclusion.requiredEvidenceIds) {
    if (!s.conclusion.supportingEvidenceIds.includes(id)) errors.push(`sample conclusion does not cite required evidence ${id}`);
  }
  const wc = wordCount(s.report);
  if (wc < d.writingTask.minWords || wc > d.writingTask.maxWords) errors.push(`sample report has ${wc} words (allowed ${d.writingTask.minWords}–${d.writingTask.maxWords})`);

  return { ok: errors.length === 0, errors, warnings, dossier: d };
}
