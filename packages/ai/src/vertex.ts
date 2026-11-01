import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Type, type Schema } from '@google/genai';
import type { CaseDossier } from '@ed/shared';
import {
  assistantSystemPrompt, assistantUserPrompt, characterSystemPrompt, characterUserPrompt,
  generatorSystemPrompt, generatorUserPrompt, gradeSystemPrompt, gradeUserPrompt,
} from './prompts.js';
import {
  AssistantOutputSchema, ASSISTANT_KINDS, CharacterOutputSchema, GradeOutputSchema,
  type AiProvider, type AssistantInput, type CaseRequest, type CharacterInput, type GradeInput, type Usage,
} from './types.js';

const STR: Schema = { type: Type.STRING };
const STRS: Schema = { type: Type.ARRAY, items: STR };
const SCORED: Schema = { type: Type.OBJECT, properties: { score: { type: Type.NUMBER }, comment: STR }, required: ['score', 'comment'] };

const CHARACTER_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { factsRevealed: STRS, outOfScope: { type: Type.BOOLEAN }, inappropriate: { type: Type.BOOLEAN }, reply: STR },
  required: ['reply', 'factsRevealed', 'outOfScope', 'inappropriate'],
  propertyOrdering: ['factsRevealed', 'outOfScope', 'inappropriate', 'reply'],
};
const ASSISTANT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { kind: { type: Type.STRING, enum: [...ASSISTANT_KINDS] }, answer: STR },
  required: ['kind', 'answer'],
};
const GRADE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    explainAnswers: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { questionId: STR, score: { type: Type.NUMBER }, comment: STR }, required: ['questionId', 'score', 'comment'] } },
    reasoning: { type: Type.OBJECT, properties: { score: { type: Type.NUMBER }, comment: STR, unsupportedClaimsUsed: STRS }, required: ['score', 'comment', 'unsupportedClaimsUsed'] },
    writing: { type: Type.OBJECT, properties: { taskAchievement: SCORED, coherence: SCORED, vocabulary: SCORED, grammar: SCORED }, required: ['taskAchievement', 'coherence', 'vocabulary', 'grammar'] },
    examples: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { quote: STR, comment: STR }, required: ['quote', 'comment'] } },
    corrections: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { original: STR, corrected: STR, explanation: STR }, required: ['original', 'corrected', 'explanation'] } },
    strengths: STRS,
    improvements: STRS,
    recommendations: {
      type: Type.OBJECT,
      properties: { vocabulary: STRS, grammar: STRS, readingSkills: STRS, reasoningSkills: STRS, nextWritingTask: STR },
      required: ['vocabulary', 'grammar', 'readingSkills', 'reasoningSkills', 'nextWritingTask'],
    },
  },
  required: ['explainAnswers', 'reasoning', 'writing', 'examples', 'corrections', 'strengths', 'improvements', 'recommendations'],
};

const SAFETY = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));

/**
 * Gemini 2.5 and 3.x Flash models "think" by default; thinking tokens count against maxOutputTokens
 * and can truncate the JSON reply (seen on k26game1 with gemini-3-flash-preview), so cap it explicitly.
 */
export function thinking(model: string, budget: number) {
  const capped = model.startsWith('gemini-2.5') || /^gemini-3[\d.]*-flash/.test(model);
  return capped ? { thinkingConfig: { thinkingBudget: budget } } : {};
}

/** Trim over-long arrays before strict validation. */
function trimArrays(raw: Record<string, unknown>, limits: Record<string, number>) {
  for (const [k, n] of Object.entries(limits)) if (Array.isArray(raw[k])) raw[k] = (raw[k] as unknown[]).slice(0, n);
  return raw;
}

export class VertexAiProvider implements AiProvider {
  readonly name = 'vertex';
  private readonly client: GoogleGenAI;

  constructor(project: string, location: string) {
    this.client = new GoogleGenAI({ vertexai: true, project, location });
  }

  private usage(m: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): Usage {
    return { inputTokens: m?.promptTokenCount ?? 0, outputTokens: (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0) };
  }

  private async json(model: string, system: string, user: string, schema: Schema | undefined, temperature: number, maxOutputTokens: number, thinkingBudget: number) {
    const res = await this.client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: {
        systemInstruction: system,
        temperature,
        maxOutputTokens,
        responseMimeType: 'application/json',
        ...(schema ? { responseSchema: schema } : {}),
        safetySettings: SAFETY,
        ...thinking(model, thinkingBudget),
      },
    });
    const text = res.text;
    if (!text) throw new Error('Empty AI response (possibly blocked or truncated)');
    return { raw: JSON.parse(text) as Record<string, unknown>, usage: this.usage(res.usageMetadata) };
  }

  async character(input: CharacterInput) {
    const r = await this.json(input.model, characterSystemPrompt(input), characterUserPrompt(input), CHARACTER_SCHEMA, input.temperature, input.maxOutputTokens, 0);
    return { output: CharacterOutputSchema.parse(r.raw), usage: r.usage };
  }

  async assistant(input: AssistantInput) {
    const r = await this.json(input.model, assistantSystemPrompt(input), assistantUserPrompt(input), ASSISTANT_SCHEMA, 0.4, input.maxOutputTokens, 0);
    return { output: AssistantOutputSchema.parse(r.raw), usage: r.usage };
  }

  async grade(input: GradeInput) {
    const r = await this.json(input.model, gradeSystemPrompt(input.dossier), gradeUserPrompt(input), GRADE_SCHEMA, 0.2, Math.max(4096, input.maxOutputTokens), 1024);
    trimArrays(r.raw, { examples: 8, corrections: 10, strengths: 6, improvements: 6, explainAnswers: 12 });
    return { output: GradeOutputSchema.parse(r.raw), usage: r.usage };
  }

  async generateCase(request: CaseRequest, example: CaseDossier, model: string, feedback?: string[]) {
    const r = await this.json(model, generatorSystemPrompt(), generatorUserPrompt(request, example, feedback), undefined, 0.8, 32768, 2048);
    return { output: r.raw, usage: r.usage };
  }

  async ping(model: string) {
    const res = await this.client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
      config: { maxOutputTokens: 256, ...thinking(model, 0) },
    });
    return (res.text ?? '').trim();
  }
}
