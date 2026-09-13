import { describe, expect, it } from 'vitest';

import {
  buildCompositionPlannerPrompt,
  formatCompositionPlan,
  resolveCompositionPlan,
  type CompositionCandidate,
} from './compositionPlanner';

const candidate = (
  id: string,
  score: number,
  firstX: number,
  secondX: number,
): CompositionCandidate => ({
  id,
  score,
  camera: 'eye-level normal lens',
  horizon: 0.58,
  rationale: `${id} keeps both silhouettes readable`,
  placements: [
    {
      sourceIndex: 0,
      role: 'hero',
      box: [firstX, 0.08, 0.42, 0.84],
      depth: 0.18,
      zIndex: 2,
      focalPriority: 1,
    },
    {
      sourceIndex: 1,
      role: 'support',
      box: [secondX, 0.18, 0.34, 0.7],
      depth: 0.62,
      zIndex: 1,
      focalPriority: 2,
    },
  ],
});

describe('composition planner', () => {
  it('builds exactly three deterministic candidates when vision analysis is unavailable', () => {
    const plan = resolveCompositionPlan('', {
      sourceCount: 2,
      aspectRatio: '16:9',
      roles: ['left', 'right'],
      userPrompt: 'Two heroes confront each other',
    });

    expect(plan.origin).toBe('fallback');
    expect(plan.candidates).toHaveLength(3);
    expect(plan.selected.placements).toHaveLength(2);
    expect(plan.selected.placements[0].box[0]).toBeLessThan(0.5);
    expect(plan.selected.placements[1].box[0]).toBeGreaterThanOrEqual(0.5);
    expect(new Set(plan.selected.placements.map((placement) => placement.depth)).size).toBe(2);
    expect(new Set(plan.selected.placements.map((placement) => placement.zIndex)).size).toBe(2);
  });

  it('rejects the highest-scored candidate when it swaps explicit source roles', () => {
    const raw = JSON.stringify({
      analyses: [
        {
          sourceIndex: 0,
          visualWeight: 0.9,
          gaze: 'right',
          motion: 'right',
          mustRemainVisible: ['face', 'weapon'],
          safeToOcclude: ['lower cape'],
          lighting: 'upper left',
        },
        {
          sourceIndex: 1,
          visualWeight: 0.65,
          gaze: 'left',
          motion: 'left',
          mustRemainVisible: ['face'],
          safeToOcclude: ['lower body'],
          lighting: 'front',
        },
      ],
      candidates: [
        candidate('swapped', 99, 0.56, 0.04),
        candidate('balanced', 86, 0.06, 0.58),
        candidate('cinematic', 92, 0.1, 0.54),
      ],
      selectedCandidateId: 'swapped',
      summary: 'A confrontation with the leading hero in front.',
    });

    const plan = resolveCompositionPlan(raw, {
      sourceCount: 2,
      aspectRatio: '16:9',
      roles: ['left', 'right'],
      userPrompt: 'Two heroes confront each other',
    });

    expect(plan.origin).toBe('vision');
    expect(plan.candidates.map(({ id }) => id)).not.toContain('swapped');
    expect(plan.selected.id).toBe('cinematic');
  });

  it('rejects a foreground subject layered behind a background subject', () => {
    const inconsistent = candidate('contradictory', 99, 0.06, 0.58);
    inconsistent.placements[0].zIndex = 1;
    inconsistent.placements[1].zIndex = 2;
    const raw = JSON.stringify({
      analyses: [
        { sourceIndex: 0, visualWeight: 0.9, gaze: 'right', motion: 'right', mustRemainVisible: ['face'], safeToOcclude: ['cape'], lighting: 'left' },
        { sourceIndex: 1, visualWeight: 0.7, gaze: 'left', motion: 'left', mustRemainVisible: ['face'], safeToOcclude: ['armor edge'], lighting: 'front' },
      ],
      candidates: [
        inconsistent,
        candidate('consistent', 91, 0.06, 0.58),
        candidate('alternate', 87, 0.1, 0.54),
      ],
      selectedCandidateId: 'contradictory',
      summary: 'Two depth planes.',
    });

    const plan = resolveCompositionPlan(raw, {
      sourceCount: 2,
      aspectRatio: '16:9',
      roles: ['left', 'right'],
      userPrompt: '',
    });

    expect(plan.origin).toBe('vision');
    expect(plan.candidates.map(({ id }) => id)).not.toContain('contradictory');
    expect(plan.selected.id).toBe('consistent');
  });

  it('fails open to a safe plan for malformed or incomplete model JSON', () => {
    for (const raw of ['not-json', '{"candidates":[]}', JSON.stringify({
      candidates: [candidate('only-one', 90, 0.05, 0.58)],
    })]) {
      const plan = resolveCompositionPlan(raw, {
        sourceCount: 2,
        aspectRatio: '16:9',
        roles: [undefined, undefined],
        userPrompt: '',
      });
      expect(plan.origin).toBe('fallback');
      expect(plan.candidates).toHaveLength(3);
    }
  });

  it('produces a bounded provider prompt with explicit depth and occlusion rules', () => {
    const plan = resolveCompositionPlan('', {
      sourceCount: 3,
      aspectRatio: '16:9',
      roles: ['left', 'center', 'right'],
      userPrompt: '',
    });
    const prompt = formatCompositionPlan(plan);

    expect(prompt).toContain('AI-SELECTED COMPOSITION PLAN');
    expect(prompt).toContain('SOURCE 1');
    expect(prompt).toContain('foreground');
    expect(prompt).toContain('Do not swap identities');
    expect(prompt.length).toBeLessThan(1_800);
  });

  it('keeps every mandatory placement field in a maximum-length four-source plan', () => {
    const long = 'x'.repeat(48);
    const candidates = ['primary', 'secondary', 'tertiary'].map((id, candidateIndex) => ({
      id,
      score: 95 - candidateIndex,
      camera: 'camera '.repeat(30),
      horizon: 0.58,
      rationale: 'rationale '.repeat(30),
      placements: Array.from({ length: 4 }, (_, sourceIndex) => ({
        sourceIndex,
        role: sourceIndex === 0 ? 'hero' : sourceIndex === 1 ? 'support' : 'atmosphere',
        box: [0.02 + sourceIndex * 0.24, 0.1, 0.22, 0.8],
        depth: 0.1 + sourceIndex * 0.28,
        zIndex: 4 - sourceIndex,
        focalPriority: sourceIndex + 1,
      })),
    }));
    const plan = resolveCompositionPlan(JSON.stringify({
      analyses: Array.from({ length: 4 }, (_, sourceIndex) => ({
        sourceIndex,
        visualWeight: 0.8,
        gaze: long,
        motion: long,
        mustRemainVisible: Array.from({ length: 5 }, () => long),
        safeToOcclude: Array.from({ length: 5 }, () => long),
        lighting: long,
      })),
      candidates,
      selectedCandidateId: 'primary',
      summary: 'summary '.repeat(50),
    }), {
      sourceCount: 4,
      aspectRatio: '21:9',
      roles: [undefined, undefined, undefined, undefined],
      userPrompt: '',
    });

    const prompt = formatCompositionPlan(plan);
    expect(prompt.length).toBeLessThan(1_800);
    for (let source = 1; source <= 4; source += 1) {
      expect(prompt).toMatch(new RegExp(`SOURCE ${source}: .*layer ${5 - source}; focus ${source}; preserve`));
    }
  });

  it('asks the vision model for grounded analyses and exactly three candidates', () => {
    const prompt = buildCompositionPlannerPrompt({
      sourceCount: 4,
      aspectRatio: '21:9',
      roles: ['left', undefined, undefined, 'right'],
      userPrompt: 'A defensive formation',
    });

    expect(prompt).toContain('exactly 3 candidates');
    expect(prompt).toContain('normalized [x,y,width,height]');
    expect(prompt).toContain('SOURCE 1 must stay on the left');
    expect(prompt).toContain('TARGET ASPECT RATIO: 21:9');
    expect(prompt.length).toBeLessThan(6_000);
  });
});
