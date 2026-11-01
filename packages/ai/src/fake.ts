import { containsPhrase, wordCount } from '@ed/game-engine';
import type { CaseDossier } from '@ed/shared';
import type { AiProvider, AssistantInput, CaseRequest, CharacterInput, GradeInput, GradeOutput } from './types.js';

/**
 * Offline provider for local development and automated tests ONLY.
 * Characters reveal eligible facts whose keywords appear in the question; grading uses simple heuristics.
 * The API refuses to start with this provider in production.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  /** Test hooks. */
  failNext = 0;
  delayMs = 0;
  /** Force the next character reply text (e.g. to test leak filters). */
  nextCharacterReply: string | null = null;

  private async gate() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Simulated AI outage');
    }
  }

  async character(input: CharacterInput) {
    await this.gate();
    const c = input.dossier.characters.find((x) => x.id === input.characterId)!;
    const eligibleIds = new Set(input.eligibleFacts.map((f) => f.id));
    // Same rule as the engine's keywordFacts: eligible facts whose keywords appear in the question.
    const ids = c.facts.filter((f) => eligibleIds.has(f.id) && f.keywords.some((k) => containsPhrase(input.question, k))).map((f) => f.id);
    const facts = input.eligibleFacts.filter((f) => ids.includes(f.id));
    let reply = facts.length ? facts.map((f) => toFirstPerson(f.text, c.name)).join(' ') : "I'm sorry, I don't know anything about that.";
    if (this.nextCharacterReply) {
      reply = this.nextCharacterReply;
      this.nextCharacterReply = null;
    }
    return { output: { reply, factsRevealed: ids, outOfScope: facts.length === 0, inappropriate: false }, usage: { inputTokens: 1500, outputTokens: 80 } };
  }

  async assistant(input: AssistantInput) {
    await this.gate();
    const wantsAnswer = /\b(answer|solution|who did|which conclusion|write (my|the) report)\b/i.test(input.question);
    return {
      output: wantsAnswer
        ? { answer: "I can't give you the answer, but try comparing each claim with an official source.", kind: 'refused' as const }
        : { answer: 'Try scanning the documents for dates, names and numbers, then compare them across sources.', kind: 'reading_strategy' as const },
      usage: { inputTokens: 2000, outputTokens: 60 },
    };
  }

  async grade(input: GradeInput) {
    await this.gate();
    const w = input.dossier.writingTask;
    const inRange = input.wordCount >= w.minWords && input.wordCount <= w.maxWords;
    const ratio = Math.min(1, input.wordCount / w.minWords);
    const firstSentence = input.report.split(/(?<=[.!?])\s+/)[0]?.trim() ?? '';
    const out: GradeOutput = {
      explainAnswers: input.explainAnswers.map((e) => ({ questionId: e.questionId, score: e.answer.trim() ? Math.ceil(e.points * 0.67) : 0, comment: 'Offline estimate (no AI).' })),
      reasoning: { score: input.conclusion?.isCorrect ? 7 : 3, comment: 'Offline estimate (no AI).', unsupportedClaimsUsed: [] },
      writing: {
        taskAchievement: { score: Math.round((inRange ? 8 : 5) * ratio), comment: 'Offline estimate (no AI).' },
        coherence: { score: Math.round(5 * ratio), comment: 'Offline estimate (no AI).' },
        vocabulary: { score: Math.round(5 * ratio), comment: 'Offline estimate (no AI).' },
        grammar: { score: Math.round(4 * ratio), comment: 'Offline estimate (no AI).' },
      },
      examples: firstSentence ? [{ quote: firstSentence.slice(0, 200), comment: 'Clear opening sentence.' }] : [],
      corrections: [{ original: 'this phrase is not in the report', corrected: 'x', explanation: 'Test: must be removed by the quote check.' }],
      strengths: ['You followed the report structure.'],
      improvements: ['Explain how each piece of evidence supports your conclusion.'],
      recommendations: { vocabulary: input.dossier.documents.flatMap((d) => d.glossary.map((g) => g.term)).slice(0, 4), grammar: ['Past simple vs present perfect'], readingSkills: ['Compare claims with official sources.'], reasoningSkills: ['Separate verified facts from claims.'], nextWritingTask: 'Write a short email summarising your findings.' },
    };
    return { output: out, usage: { inputTokens: 5000, outputTokens: 800 } };
  }

  async generateCase(request: CaseRequest, example: CaseDossier) {
    await this.gate();
    const clone = structuredClone(example);
    clone.id = request.caseId;
    clone.level = request.level;
    clone.title = { en: `Draft: ${request.topic}`, vi: `Bản nháp: ${request.topic}` };
    clone.topic = request.topic;
    return { output: clone, usage: { inputTokens: 20000, outputTokens: 12000 } };
  }

  async ping() {
    return 'ready (offline provider)';
  }
}

function toFirstPerson(text: string, name: string): string {
  const first = name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/, '').split(' ')[0]!;
  return text.replace(new RegExp(`^(${name}|${first})\\b`), 'I').replace(new RegExp(`\\b(${name}|${first})\\b`, 'g'), 'I');
}

export { wordCount };
