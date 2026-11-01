import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CaseDossierSchema } from '@ed/shared';
import {
  EngineError, answerQuestion, collectHighlight, initialState, isDocumentUnlocked, keywordFacts, matchHighlight, nextHint,
  openDocument, revealFacts, setConclusion, submissionBlockers, updateBoard,
} from '../src/state.js';
import { conclusionScore, evidenceScore, gamePoints, readingParts, readingScore, recommendNextCase, computeAchievements } from '../src/scoring.js';
import { normalizeText, wordCount } from '../src/text.js';
import { playSample } from './play.js';

const d = CaseDossierSchema.parse(JSON.parse(readFileSync(new URL('../../../content/cases/CASE01.json', import.meta.url), 'utf8')));

describe('text helpers', () => {
  it('normalizes emails, money and decimals consistently', () => {
    expect(normalizeText('Contact: awards@intl-univ-scholarships.com.')).toBe('contact awards@intl univ scholarships com');
    expect(normalizeText('pH fell to 4.5 (−2%)!')).toBe('ph fell to 4.5 2%');
    expect(normalizeText('$5,000')).toBe('$5 000');
  });
  it('counts words like a writing teacher', () => {
    expect(wordCount("It's a well-known scam, isn't it?")).toBe(6);
  });
});

describe('unlocking', () => {
  it('locked documents cannot be opened or highlighted', () => {
    const s = initialState();
    expect(isDocumentUnlocked(d, s, 'd_it_report')).toBe(false);
    expect(() => openDocument(d, s, 'd_it_report')).toThrow(EngineError);
    expect(() => collectHighlight(d, s, 'd_it_report', 'The bank account in the message does not belong to International University', 'c1')).toThrow(/not available/);
  });
  it('a character can only reveal its own eligible facts', () => {
    const s = initialState();
    const r = revealFacts(d, s, 'emma', ['f_emma_applied', 'f_anna_checked', 'f_does_not_exist']);
    expect(r.accepted).toEqual(['f_emma_applied']);
    expect(r.rejected).toEqual(['f_anna_checked', 'f_does_not_exist']);
    expect(r.newlyUnlockedDocumentIds).toEqual([]);
  });
  it('revealing the IT check unlocks the security report', () => {
    const r = revealFacts(d, initialState(), 'anna', keywordFacts(d, initialState(), 'anna', 'Did you check the email?'));
    expect(r.accepted).toContain('f_anna_checked');
    expect(r.newlyUnlockedDocumentIds).toEqual(['d_it_report']);
  });
});

describe('highlight matching', () => {
  it('matches exact, full-sentence and partial (≥60%) selections', () => {
    expect(matchHighlight(d, 'd_scam_email', 'you must pay a processing fee of $150 within 48 hours').evidenceId).toBe('ev_fee');
    expect(matchHighlight(d, 'd_scam_email', 'To receive your scholarship, you must pay a processing fee of $150 within 48 hours.').evidenceId).toBe('ev_fee');
    expect(matchHighlight(d, 'd_scam_email', 'pay a processing fee of $150 within 48').evidenceId).toBe('ev_fee');
  });
  it('rejects tiny fragments, whole-document grabs and invented text', () => {
    expect(matchHighlight(d, 'd_scam_email', 'processing fee').evidenceId).toBeNull();
    const body = d.documents.find((x) => x.id === 'd_scam_email')!.body;
    expect(matchHighlight(d, 'd_scam_email', body).evidenceId).toBeNull();
    expect(matchHighlight(d, 'd_scam_email', 'the university is a scam').inDocument).toBe(false);
  });
  it('stores unmatched highlights as personal clues once', () => {
    let r = collectHighlight(d, initialState(), 'd_scam_email', 'Bank: Global Trust Bank', 'c1');
    expect(r.evidenceId).toBeNull();
    expect(r.state.clues).toHaveLength(1);
    r = collectHighlight(d, r.state, 'd_scam_email', 'Bank: Global Trust Bank', 'c2');
    expect(r.isNew).toBe(false);
    expect(r.state.clues).toHaveLength(1);
  });
});

describe('questions', () => {
  it('auto-scores objective answers and allows one attempt', () => {
    let s = initialState();
    let r = answerQuestion(d, s, 'q_results_date', 'March 20');
    expect(r.correct).toBe(true);
    s = r.state;
    expect(() => answerQuestion(d, s, 'q_results_date', '20 March')).toThrow(/already/);
    r = answerQuestion(d, s, 'q_private_email', 'True');
    expect(r.correct).toBe(false);
    r = answerQuestion(d, r.state, 'q_applicants', 'Not Given');
    expect(r.correct).toBe(true);
  });
  it('rejects malformed answers', () => {
    expect(() => answerQuestion(d, initialState(), 'q_value', 9)).toThrow(/options/);
    expect(() => answerQuestion(d, initialState(), 'q_private_email', 'maybe')).toThrow(/True, False/);
  });
  it('explain answers are left for the AI', () => {
    const r = answerQuestion(d, initialState(), 'q_inconsistent', 'The fee and the address are wrong.');
    expect(r.correct).toBeNull();
  });
});

describe('board, conclusion and submission', () => {
  it('blocks submission until requirements are met', () => {
    expect(submissionBlockers(d, initialState()).length).toBe(3);
  });
  it('cannot categorize or cite uncollected evidence', () => {
    expect(() => updateBoard(initialState(), { items: { ev_fee: { category: 'verified', note: '' } }, links: [] })).toThrow();
    expect(() => setConclusion(d, initialState(), { optionId: 'c_phishing', supportingEvidenceIds: ['ev_fee'], justification: 'x' })).toThrow();
  });
  it('hints have three levels per stage', () => {
    let s = initialState();
    for (let i = 1; i <= 3; i++) {
      const r = nextHint(d, s, 'evidence');
      expect(r.level).toBe(i);
      s = r.state;
    }
    expect(() => nextHint(d, s, 'evidence')).toThrow(/three hints/);
  });
});

describe('scoring', () => {
  const { state } = playSample(d);
  it('gives full machine scores for the sample solution', () => {
    expect(readingScore(readingParts(d, state), 6).score).toBe(25);
    expect(evidenceScore(d, state).score).toBe(25);
    expect(conclusionScore(d, state)).toMatchObject({ score: 10, correct: true });
  });
  it('wrong conclusion or weak support loses critical-thinking points', () => {
    expect(conclusionScore(d, { ...state, conclusion: { ...state.conclusion!, optionId: 'c_genuine' } }).score).toBe(0);
    const weak = conclusionScore(d, { ...state, conclusion: { ...state.conclusion!, supportingEvidenceIds: ['ev_fee', 'ev_logo_claim'] } });
    expect(weak.score).toBeLessThan(10);
    expect(weak.weakSupport).toEqual(['ev_logo_claim']);
  });
  it('wrong categories and missed key evidence lower the evidence score', () => {
    const board = Object.fromEntries(Object.keys(state.board).map((k) => [k, { category: 'irrelevant' as const, note: '' }]));
    expect(evidenceScore(d, { ...state, board }).score).toBeLessThan(20);
    const { ev_domain_registered: _, ...collected } = state.collected;
    const r = evidenceScore(d, { ...state, collected });
    expect(r.missedKeyEvidence.map((m) => m.id)).toEqual(['ev_domain_registered']);
  });
  it('reading without AI is scored on the objective part only', () => {
    const r = readingScore(readingParts(d, state), null);
    expect(r.score).toBe(25);
    expect(r.assessedFraction).toBeLessThan(1);
  });
  it('game points drop with hints but never go negative', () => {
    const base = gamePoints(d, state, true).detectivePoints;
    const hinted = gamePoints(d, { ...state, hintsUsed: { documents: 3, evidence: 3, interviews: 3, analysis: 3, report: 3 } }, true).detectivePoints;
    expect(hinted).toBe(base - 150);
    expect(gamePoints(d, { ...state, collected: {}, revealedFactIds: [], hintsUsed: { documents: 3, evidence: 3, interviews: 3, analysis: 3, report: 3 } }, false).detectivePoints).toBe(0);
  });
  it('achievements and next case', () => {
    const a = computeAchievements(['CASE01'], d, state, true, 26, [], []);
    expect(a).toEqual(expect.arrayContaining(['first_case', 'sharp_eye', 'interviewer', 'fine_writer', 'master_detective']));
    expect(recommendNextCase([{ id: 'CASE01', level: 'B1' }, { id: 'CASE04', level: 'B2' }], d, true, 90, []).nextCaseId).toBe('CASE04');
    expect(recommendNextCase([{ id: 'CASE01', level: 'B1' }], d, false, 30, []).nextCaseId).toBe('CASE01');
  });
});
