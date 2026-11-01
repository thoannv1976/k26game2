import { containsPhrase, normalizeText } from '@ed/game-engine';
import type { CaseDossier } from '@ed/shared';
import type { CharacterOutput, GradeOutput } from './types.js';
import { isInappropriate } from './moderation.js';

export const CHARACTER_FALLBACK = "I'm sorry, I'm not able to talk about that right now. Could you ask me something else about the case?";

/**
 * Server-side check of a character reply. Rejects replies that contain restricted phrases,
 * the text of facts the character may not share yet, or the solution.
 */
export function guardCharacterReply(d: CaseDossier, characterId: string, eligibleFactIds: string[], out: CharacterOutput): { output: CharacterOutput; blocked: string | null } {
  const c = d.characters.find((x) => x.id === characterId)!;
  const reply = out.reply;
  const block = (reason: string) => ({ output: { reply: CHARACTER_FALLBACK, factsRevealed: [], outOfScope: true, inappropriate: out.inappropriate }, blocked: reason });
  if (out.inappropriate || isInappropriate(reply)) return block('inappropriate');
  for (const r of c.restricted) for (const p of r.forbiddenPhrases) if (containsPhrase(reply, p)) return block(`restricted:${r.topic}`);
  const correct = d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text;
  if (normalizeText(reply).includes(normalizeText(correct))) return block('solution');
  // Facts from any character that are not eligible now must not be quoted.
  const locked = d.characters.flatMap((x) => x.facts).filter((f) => !eligibleFactIds.includes(f.id));
  for (const f of locked) {
    if (normalizeText(f.text).length > 20 && normalizeText(reply).includes(normalizeText(f.text))) return block(`locked_fact:${f.id}`);
  }
  return { output: { ...out, factsRevealed: out.factsRevealed.filter((id) => eligibleFactIds.includes(id)) }, blocked: null };
}

export function guardAssistantAnswer(d: CaseDossier, answer: string): string | null {
  const correct = d.conclusion.options.find((o) => o.id === d.conclusion.correctOptionId)!.text;
  if (normalizeText(answer).includes(normalizeText(correct))) return 'solution';
  if (isInappropriate(answer)) return 'inappropriate';
  return null;
}

/**
 * Keeps only examples/corrections whose quoted text really appears in the report, clamps scores.
 * Returns how many items were removed (logged for quality monitoring).
 */
export function verifyGrade(d: CaseDossier, report: string, explainMax: Record<string, number>, g: GradeOutput): { grade: GradeOutput; removed: number } {
  const inReport = (q: string) => q.trim().length >= 2 && normalizeText(report).includes(normalizeText(q));
  const examples = g.examples.filter((e) => inReport(e.quote));
  const corrections = g.corrections.filter((c) => inReport(c.original) && normalizeText(c.original) !== normalizeText(c.corrected));
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * 2) / 2));
  const r = d.writingTask.rubric;
  return {
    removed: g.examples.length - examples.length + (g.corrections.length - corrections.length),
    grade: {
      ...g,
      examples,
      corrections,
      explainAnswers: g.explainAnswers.filter((e) => e.questionId in explainMax).map((e) => ({ ...e, score: clamp(e.score, explainMax[e.questionId]!) })),
      reasoning: { ...g.reasoning, score: clamp(g.reasoning.score, 10) },
      writing: {
        taskAchievement: { ...g.writing.taskAchievement, score: clamp(g.writing.taskAchievement.score, r.taskAchievement) },
        coherence: { ...g.writing.coherence, score: clamp(g.writing.coherence.score, r.coherence) },
        vocabulary: { ...g.writing.vocabulary, score: clamp(g.writing.vocabulary.score, r.vocabulary) },
        grammar: { ...g.writing.grammar, score: clamp(g.writing.grammar.score, r.grammar) },
      },
    },
  };
}
