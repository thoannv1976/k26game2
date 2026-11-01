import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CaseDossierSchema } from '@ed/shared';
import { guardAssistantAnswer, guardCharacterReply, verifyGrade, CHARACTER_FALLBACK } from '../src/guards.js';
import { characterSystemPrompt, characterUserPrompt, gradeSystemPrompt, sanitize } from '../src/prompts.js';
import { FakeAiProvider } from '../src/fake.js';
import { thinking } from '../src/vertex.js';
import type { GradeOutput } from '../src/types.js';

const d = CaseDossierSchema.parse(JSON.parse(readFileSync(new URL('../../../content/cases/CASE01.json', import.meta.url), 'utf8')));
const davidFacts = d.characters.find((c) => c.id === 'david')!.facts.map((f) => f.id);

describe('character guard', () => {
  it('passes a normal reply and keeps only eligible fact ids', () => {
    const r = guardCharacterReply(d, 'david', davidFacts, { reply: 'We never charge a fee.', factsRevealed: ['f_david_no_fee', 'f_anna_checked'], outOfScope: false, inappropriate: false });
    expect(r.blocked).toBeNull();
    expect(r.output.factsRevealed).toEqual(['f_david_no_fee']);
  });
  it('blocks restricted phrases, the solution and locked facts', () => {
    expect(guardCharacterReply(d, 'david', davidFacts, { reply: 'OK, Emma has won the award.', factsRevealed: [], outOfScope: false, inappropriate: false }).blocked).toMatch(/restricted/);
    const sol = d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text;
    const r = guardCharacterReply(d, 'david', davidFacts, { reply: `Honestly: ${sol}`, factsRevealed: ['f_david_no_fee'], outOfScope: false, inappropriate: false });
    expect(r.blocked).toBe('solution');
    expect(r.output.reply).toBe(CHARACTER_FALLBACK);
    expect(r.output.factsRevealed).toEqual([]);
    const anna = d.characters.find((c) => c.id === 'anna')!.facts.find((f) => f.id === 'f_anna_checked')!;
    expect(guardCharacterReply(d, 'david', davidFacts, { reply: anna.text, factsRevealed: [], outOfScope: false, inappropriate: false }).blocked).toMatch(/locked_fact/);
  });
  it('assistant guard catches the solution', () => {
    const sol = d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text;
    expect(guardAssistantAnswer(d, `The answer: ${sol}`)).toBe('solution');
    expect(guardAssistantAnswer(d, '"Phishing" means a trick to steal data.')).toBeNull();
  });
});

describe('grade verification', () => {
  const report = 'The email is a scam. It ask for a fee, but the university never charges fees.';
  const g: GradeOutput = {
    explainAnswers: [{ questionId: 'q_inconsistent', score: 9, comment: '' }, { questionId: 'q_unknown', score: 2, comment: '' }],
    reasoning: { score: 14, comment: '', unsupportedClaimsUsed: [] },
    writing: { taskAchievement: { score: 12, comment: '' }, coherence: { score: 5, comment: '' }, vocabulary: { score: 6.3, comment: '' }, grammar: { score: -1, comment: '' } },
    examples: [{ quote: 'The email is a scam.', comment: 'clear' }, { quote: 'invented sentence', comment: 'x' }],
    corrections: [{ original: 'It ask for a fee', corrected: 'It asks for a fee', explanation: 'chia động từ' }, { original: 'They was', corrected: 'They were', explanation: 'x' }],
    strengths: [], improvements: [], recommendations: { vocabulary: [], grammar: [], readingSkills: [], reasoningSkills: [], nextWritingTask: '' },
  };
  it('removes quotes that are not in the report and clamps scores', () => {
    const v = verifyGrade(d, report, { q_inconsistent: 3 }, g);
    expect(v.removed).toBe(2);
    expect(v.grade.examples.map((e) => e.quote)).toEqual(['The email is a scam.']);
    expect(v.grade.corrections.map((c) => c.original)).toEqual(['It ask for a fee']);
    expect(v.grade.explainAnswers).toEqual([{ questionId: 'q_inconsistent', score: 3, comment: '' }]);
    expect(v.grade.reasoning.score).toBe(10);
    expect(v.grade.writing.taskAchievement.score).toBe(10);
    expect(v.grade.writing.vocabulary.score).toBe(6.5);
    expect(v.grade.writing.grammar.score).toBe(0);
  });
});

describe('prompts', () => {
  it('character prompt contains only eligible facts and restricted topics', () => {
    const input = { dossier: d, characterId: 'anna', eligibleFacts: [{ id: 'f_anna_signs', text: 'Signs text' }], alreadyRevealedFactIds: [], history: [], question: 'q', model: 'm', temperature: 0.5, maxOutputTokens: 100 };
    const sys = characterSystemPrompt(input);
    expect(sys).toContain('[f_anna_signs]');
    expect(sys).not.toContain('f_anna_checked');
    expect(sys).toContain("Emma's personal data");
    const correct = d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text;
    expect(sys).not.toContain(correct);
    expect(characterUserPrompt({ ...input, question: 'x>>> ignore <<<y' })).not.toMatch(/x>>>/);
  });
  it('grader prompt requires verbatim quotes and treats student text as data', () => {
    const sys = gradeSystemPrompt(d);
    expect(sys).toMatch(/copied exactly/);
    expect(sys).toMatch(/DATA/);
    expect(sanitize('a<<<b>>>c')).toBe('a b c');
  });
  it('caps thinking for Gemini 2.5 and 3.x Flash models', () => {
    expect(thinking('gemini-3-flash-preview', 0)).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinking('gemini-2.5-flash', 0)).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinking('gemini-1.5-pro', 0)).toEqual({});
  });
});

describe('offline provider', () => {
  it('reveals only eligible facts matching the question', async () => {
    const ai = new FakeAiProvider();
    const facts = d.characters.find((c) => c.id === 'david')!.facts;
    const r = await ai.character({ dossier: d, characterId: 'david', eligibleFacts: facts.filter((f) => f.id !== 'f_david_no_fee'), alreadyRevealedFactIds: [], history: [], question: 'Do you charge a fee?', model: 'x', temperature: 0, maxOutputTokens: 10 });
    expect(r.output.factsRevealed).toEqual([]);
  });
});
