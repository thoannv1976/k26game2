import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkDossier } from '../src/validate.js';
import { submissionBlockers, stageProgress } from '../src/state.js';
import { conclusionScore, evidenceScore, readingParts, readingScore } from '../src/scoring.js';
import { investigationView } from '../src/view.js';
import { playSample } from './play.js';

const dir = new URL('../../../content/cases/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^CASE\d+\.json$/.test(f)).sort();

describe.each(files)('%s', (file) => {
  const raw = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  const check = checkDossier(raw);

  it('passes schema and consistency checks', () => {
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('can be completed with its sample solution and scores full marks on machine-scored parts', () => {
    const d = check.dossier!;
    const { state, log } = playSample(d);
    expect(log).toEqual([]);
    expect(submissionBlockers(d, state)).toEqual([]);
    const p = stageProgress(d, state, false);
    expect(p.evidence && p.interviews && p.analysis).toBe(true);
    const reading = readingScore(readingParts(d, state), null);
    expect(reading.score).toBe(25); // all objective answers correct
    const ev = evidenceScore(d, state);
    expect(ev.keyFound).toBe(ev.keyTotal);
    expect(ev.score).toBeGreaterThanOrEqual(22);
    expect(conclusionScore(d, state).score).toBe(10);
  });

  it('never leaks hidden data to the student view', () => {
    const d = check.dossier!;
    const { state } = playSample(d);
    const json = JSON.stringify(investigationView({ dossier: d, state, submitted: false, limits: { interviewQuestionsPerCharacter: 8, assistantRequests: 10 } }));
    // Hidden fields (JSON keys) must never appear in the student view.
    for (const key of ['correctIndex', 'acceptable', 'keyPoints', 'sampleAnswer', 'correctOptionId', 'requiredEvidenceIds', 'unsupportedClaims', 'sampleSolution', 'facts', 'forbiddenPhrases', 'explanation', 'keywords', 'restricted']) {
      expect(json).not.toContain(`"${key}":`);
    }
    for (const e of d.evidence) expect(json).not.toContain(e.explanation);
    for (const c of d.characters) for (const f of c.facts) expect(json).not.toContain(f.text);
  });

  it('a fresh investigation shows locked documents without their content', () => {
    const d = check.dossier!;
    const locked = d.documents.filter((x) => x.unlock.type !== 'start');
    const v = investigationView({ dossier: d, state: { ...playSample(d).state, revealedFactIds: [], collected: {}, answers: {} }, submitted: false, limits: { interviewQuestionsPerCharacter: 8, assistantRequests: 10 } });
    for (const doc of locked) {
      const shown = v.documents.find((x) => x.id === doc.id)!;
      expect(shown.locked).toBe(true);
      expect(shown.body).toBe('');
    }
  });
});
