import type { CaseDossier } from '@ed/shared';
import {
  acknowledgeBriefing, answerQuestion, collectHighlight, countInterview, initialState, keywordFacts, openDocument,
  revealFacts, setConclusion, unlockedDocuments, updateBoard, type InvestigationState,
} from '../src/state.js';

/** Plays a dossier with its own sample solution through the engine (offline fact matching). */
export function playSample(d: CaseDossier): { state: InvestigationState; log: string[] } {
  const log: string[] = [];
  let s = acknowledgeBriefing(initialState());
  for (const doc of unlockedDocuments(d, s)) s = openDocument(d, s, doc.id);
  // Interviews first: they may unlock documents.
  for (const iq of d.sampleSolution.interviewQuestions) {
    const proposed = keywordFacts(d, s, iq.characterId, iq.question);
    const r = revealFacts(d, s, iq.characterId, proposed);
    s = countInterview(r.state, iq.characterId);
    for (const f of iq.expectFactIds) if (!s.revealedFactIds.includes(f)) log.push(`interview "${iq.question}" did not reveal ${f}`);
  }
  // Interview every character at least once.
  for (const c of d.characters) if (!s.interviewCounts[c.id]) s = countInterview(s, c.id);
  for (const doc of unlockedDocuments(d, s)) s = openDocument(d, s, doc.id);
  // Highlights (repeat to allow evidence-based unlocks).
  for (let round = 0; round < 3; round++) {
    for (const h of d.sampleSolution.highlights) {
      if (s.collected[h.evidenceId]) continue;
      if (!unlockedDocuments(d, s).some((x) => x.id === h.documentId)) continue;
      const r = collectHighlight(d, s, h.documentId, h.text, `clue_${h.evidenceId}`);
      if (r.evidenceId !== h.evidenceId) log.push(`highlight for ${h.evidenceId} matched ${r.evidenceId}`);
      s = r.state;
    }
  }
  for (const h of d.sampleSolution.highlights) if (!s.collected[h.evidenceId]) log.push(`could not collect ${h.evidenceId} (document locked?)`);
  // Answers (repeat for question-based unlocks).
  for (let round = 0; round < 3; round++) {
    for (const q of d.questions) {
      if (s.answers[q.id]) continue;
      try {
        const r = answerQuestion(d, s, q.id, d.sampleSolution.answers[q.id]!);
        s = r.state;
        if (r.correct === false) log.push(`sample answer for ${q.id} is marked wrong`);
      } catch {
        /* locked this round */
      }
    }
  }
  for (const q of d.questions) if (!s.answers[q.id]) log.push(`question ${q.id} never became available`);
  const items: Record<string, { category: 'verified' | 'unverified' | 'irrelevant'; note: string }> = {};
  for (const id of Object.keys(s.collected)) items[id] = { category: d.evidence.find((e) => e.id === id)!.category, note: '' };
  s = updateBoard(s, { items, links: d.sampleSolution.links.map(({ a, b }) => ({ a, b, note: '' })).filter((l) => s.collected[l.a] && s.collected[l.b]) });
  s = setConclusion(d, s, d.sampleSolution.conclusion);
  return { state: s, log };
}
