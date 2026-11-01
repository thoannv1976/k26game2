import { describe, expect, it } from 'vitest';
import { getBuiltinCase } from '@ed/game-engine';
import { buildCriteria, applyReview, totals } from '../../src/services/grading.js';
import { assertSafeConfig, loadConfig } from '../../src/config.js';
import { playSample } from '../../../../packages/game-engine/test/play.js';
import type { SessionDoc } from '../../src/types.js';

const d = getBuiltinCase('CASE01')!;
const s = { state: playSample(d).state } as SessionDoc;
const ai = {
  explainAnswers: [{ questionId: 'q_inconsistent', score: 3, comment: '' }, { questionId: 'q_check_before', score: 2, comment: '' }],
  reasoning: { score: 8, comment: 'ok', unsupportedClaimsUsed: [] },
  writing: { taskAchievement: { score: 9, comment: '' }, coherence: { score: 6, comment: '' }, vocabulary: { score: 5, comment: '' }, grammar: { score: 5, comment: '' } },
  examples: [], corrections: [], strengths: [], improvements: [],
  recommendations: { vocabulary: [], grammar: [], readingSkills: [], reasoningSkills: [], nextWritingTask: '' },
};

describe('assessment assembly', () => {
  it('combines engine and AI scores to 100', () => {
    const { criteria } = buildCriteria(d, s, ai);
    expect(criteria.reading.score).toBe(23); // (6/6 objective + 5/6 explain) of 25
    expect(criteria.evidence.score).toBe(25);
    expect(criteria.criticalThinking.score).toBe(18);
    expect(criteria.writing.score).toBe(25);
    expect(totals(criteria)).toEqual({ total: 91, maxAssessed: 100, percent: 91 });
  });
  it('without AI: writing not assessed, critical thinking partial, percent over assessed part only', () => {
    const { criteria } = buildCriteria(d, s, null);
    expect(criteria.writing).toMatchObject({ score: null, status: 'not_assessed', assessedMax: 0 });
    expect(criteria.criticalThinking).toMatchObject({ score: 10, status: 'partial', assessedMax: 10 });
    expect(totals(criteria)).toEqual({ total: 60, maxAssessed: 60, percent: 100 });
  });
  it('teacher review fills in and overrides criteria', () => {
    const { criteria } = buildCriteria(d, s, null);
    const r = applyReview(criteria, { reviewerUid: 't', reviewerName: 'T', comment: '', status: 'adjusted', reviewedAt: '', scores: { writing: 20, criticalThinking: 15 } });
    expect(r.criteria.writing).toMatchObject({ score: 20, source: 'teacher', assessedMax: 30 });
    expect(r.total).toBe(25 + 25 + 15 + 20);
    expect(r.percent).toBe(85);
  });
});

describe('config', () => {
  it('refuses the offline AI provider in production', () => {
    const cfg = loadConfig({ env: 'test' });
    expect(() => assertSafeConfig({ ...cfg, env: 'production', aiProvider: 'fake' })).toThrow(/AI_PROVIDER/);
    expect(cfg.firestoreDatabase).toBe('detective');
  });
});
