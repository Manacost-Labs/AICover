export type SourceRole = 'left' | 'center' | 'right';
export type CompositionRole = 'hero' | 'support' | 'atmosphere';
export type NormalizedBox = [number, number, number, number];

export interface CompositionPlannerInput {
  sourceCount: number;
  aspectRatio: string;
  roles: Array<SourceRole | undefined>;
  userPrompt: string;
}

export interface CompositionSourceAnalysis {
  sourceIndex: number;
  visualWeight: number;
  gaze: string;
  motion: string;
  mustRemainVisible: string[];
  safeToOcclude: string[];
  lighting: string;
}

export interface CompositionPlacement {
  sourceIndex: number;
  role: CompositionRole;
  box: NormalizedBox;
  depth: number;
  zIndex: number;
  focalPriority: number;
}

export interface CompositionCandidate {
  id: string;
  score: number;
  camera: string;
  horizon: number;
  rationale: string;
  placements: CompositionPlacement[];
}

export interface CompositionPlan {
  origin: 'vision' | 'fallback';
  aspectRatio: string;
  analyses: CompositionSourceAnalysis[];
  candidates: CompositionCandidate[];
  selected: CompositionCandidate;
  summary: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const boundedText = (value: unknown, fallback: string, maxLength = 160): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
};

const stringList = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundedText(item, '', 48))
    .filter(Boolean)
    .slice(0, 5);
  return normalized.length > 0 ? normalized : fallback;
};

const normalizeInput = (input: CompositionPlannerInput): CompositionPlannerInput => ({
  sourceCount: clamp(Math.round(input.sourceCount || 1), 1, 4),
  aspectRatio: boundedText(input.aspectRatio, '16:9', 12),
  roles: Array.from({ length: clamp(Math.round(input.sourceCount || 1), 1, 4) }, (_, index) =>
    input.roles[index],
  ),
  userPrompt: boundedText(input.userPrompt, 'Create a clear, cinematic cover composition.', 600),
});

const roleForIndex = (index: number, sourceCount: number): SourceRole => {
  if (sourceCount === 1) return 'center';
  if (index === 0) return 'left';
  if (index === sourceCount - 1) return 'right';
  return 'center';
};

const fallbackAnalyses = (input: CompositionPlannerInput): CompositionSourceAnalysis[] =>
  Array.from({ length: input.sourceCount }, (_, sourceIndex) => ({
    sourceIndex,
    visualWeight: sourceIndex === 0 ? 0.9 : clamp(0.75 - sourceIndex * 0.08, 0.45, 0.8),
    gaze: 'unknown; preserve the original face direction',
    motion: 'follow the original silhouette and implied movement',
    mustRemainVisible: ['face', 'recognizable silhouette'],
    safeToOcclude: ['outer lower-body edge'],
    lighting: 'preserve source-specific face and material cues',
  }));

const fallbackCandidate = (
  input: CompositionPlannerInput,
  id: string,
  score: number,
  variant: number,
): CompositionCandidate => {
  const count = input.sourceCount;
  const widths = count === 1 ? [0.56] : count === 2 ? [0.43, 0.38] : count === 3 ? [0.34, 0.38, 0.32] : [0.28, 0.3, 0.3, 0.27];
  const defaultCenters = count === 1 ? [0.5] : count === 2 ? [0.28, 0.72] : count === 3 ? [0.2, 0.5, 0.8] : [0.14, 0.38, 0.64, 0.87];
  const offsets = variant === 0 ? 0 : variant === 1 ? -0.018 : 0.018;
  const placements = Array.from({ length: count }, (_, sourceIndex): CompositionPlacement => {
    const explicitRole = input.roles[sourceIndex];
    const role = explicitRole ?? roleForIndex(sourceIndex, count);
    const width = widths[sourceIndex];
    const centered = role === 'left' ? Math.min(defaultCenters[sourceIndex], 0.36)
      : role === 'right' ? Math.max(defaultCenters[sourceIndex], 0.64)
        : clamp(defaultCenters[sourceIndex], 0.38, 0.62);
    const height = clamp(0.82 - sourceIndex * 0.045 + (variant === 2 ? 0.025 : 0), 0.62, 0.86);
    const x = clamp(centered - width / 2 + offsets * (sourceIndex % 2 === 0 ? 1 : -1), 0.02, 0.98 - width);
    const y = clamp(0.5 - height / 2 + (sourceIndex % 2) * 0.035, 0.04, 0.96 - height);
    const depth = clamp(0.18 + ((sourceIndex + variant) % count) * (0.66 / Math.max(1, count - 1)), 0.12, 0.86);
    return {
      sourceIndex,
      role: sourceIndex === 0 ? 'hero' : sourceIndex === 1 ? 'support' : 'atmosphere',
      box: [x, y, width, height],
      depth,
      zIndex: count - ((sourceIndex + variant) % count),
      focalPriority: sourceIndex + 1,
    };
  });

  return {
    id,
    score,
    camera: variant === 1 ? 'slightly low eye line, normal lens' : 'eye-level normal lens',
    horizon: variant === 2 ? 0.55 : 0.6,
    rationale: variant === 0
      ? 'Keeps the primary silhouettes readable and separates them by depth.'
      : variant === 1
        ? 'Adds restrained asymmetry while preserving explicit source sides.'
        : 'Uses a compact triangular rhythm with protected faces and foreground separation.',
    placements,
  };
};

const fallbackPlan = (rawInput: CompositionPlannerInput): CompositionPlan => {
  const input = normalizeInput(rawInput);
  const candidates = [
    fallbackCandidate(input, 'balanced-depth', 88, 0),
    fallbackCandidate(input, 'restrained-asymmetry', 84, 1),
    fallbackCandidate(input, 'compact-cinematic', 82, 2),
  ];
  return {
    origin: 'fallback',
    aspectRatio: input.aspectRatio,
    analyses: fallbackAnalyses(input),
    candidates,
    selected: candidates[0],
    summary: 'A safe, legible hierarchy with separated depth planes and protected identities.',
  };
};

const extractJsonObject = (raw: string): unknown => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
};

const normalizeAnalysis = (
  value: unknown,
  sourceIndex: number,
): CompositionSourceAnalysis | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.sourceIndex !== sourceIndex || !finite(item.visualWeight)) return null;
  return {
    sourceIndex,
    visualWeight: clamp(item.visualWeight, 0, 1),
    gaze: boundedText(item.gaze, 'unknown'),
    motion: boundedText(item.motion, 'neutral'),
    mustRemainVisible: stringList(item.mustRemainVisible, ['face', 'recognizable silhouette']),
    safeToOcclude: stringList(item.safeToOcclude, ['outer lower-body edge']),
    lighting: boundedText(item.lighting, 'preserve source lighting cues'),
  };
};

const validExplicitSide = (placement: CompositionPlacement, role: SourceRole | undefined): boolean => {
  if (!role) return true;
  const center = placement.box[0] + placement.box[2] / 2;
  if (role === 'left') return center < 0.5;
  if (role === 'right') return center >= 0.5;
  return center >= 0.3 && center <= 0.7;
};

const normalizePlacement = (
  value: unknown,
  sourceCount: number,
): CompositionPlacement | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!Number.isInteger(item.sourceIndex) || (item.sourceIndex as number) < 0 || (item.sourceIndex as number) >= sourceCount) return null;
  if (!['hero', 'support', 'atmosphere'].includes(String(item.role))) return null;
  if (!Array.isArray(item.box) || item.box.length !== 4 || !item.box.every(finite)) return null;
  const [x, y, width, height] = item.box as number[];
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.02 || y + height > 1.02) return null;
  if (!finite(item.depth) || item.depth < 0 || item.depth > 1) return null;
  if (!Number.isInteger(item.zIndex) || (item.zIndex as number) < 1 || (item.zIndex as number) > sourceCount) return null;
  if (!Number.isInteger(item.focalPriority) || (item.focalPriority as number) < 1 || (item.focalPriority as number) > sourceCount) return null;
  return {
    sourceIndex: item.sourceIndex as number,
    role: item.role as CompositionRole,
    box: [x, y, width, height],
    depth: item.depth,
    zIndex: item.zIndex as number,
    focalPriority: item.focalPriority as number,
  };
};

const normalizeCandidate = (
  value: unknown,
  input: CompositionPlannerInput,
): CompositionCandidate | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.placements) || item.placements.length !== input.sourceCount) return null;
  const placements = item.placements.map((placement) => normalizePlacement(placement, input.sourceCount));
  if (placements.some((placement) => placement === null)) return null;
  const normalizedPlacements = placements as CompositionPlacement[];
  const sourceIndexes = normalizedPlacements.map(({ sourceIndex }) => sourceIndex);
  const zIndexes = normalizedPlacements.map(({ zIndex }) => zIndex);
  const priorities = normalizedPlacements.map(({ focalPriority }) => focalPriority);
  if (new Set(sourceIndexes).size !== input.sourceCount || new Set(zIndexes).size !== input.sourceCount || new Set(priorities).size !== input.sourceCount) return null;
  if (!normalizedPlacements.every((placement) => validExplicitSide(placement, input.roles[placement.sourceIndex]))) return null;
  if (!finite(item.score) || !finite(item.horizon) || item.horizon < 0 || item.horizon > 1) return null;
  return {
    id: boundedText(item.id, '', 48),
    score: clamp(item.score, 0, 100),
    camera: boundedText(item.camera, 'eye-level normal lens'),
    horizon: item.horizon,
    rationale: boundedText(item.rationale, 'Keeps all sources readable.', 240),
    placements: normalizedPlacements,
  };
};

export const resolveCompositionPlan = (
  raw: string,
  rawInput: CompositionPlannerInput,
): CompositionPlan => {
  const input = normalizeInput(rawInput);
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return fallbackPlan(input);
  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.analyses) || value.analyses.length !== input.sourceCount) return fallbackPlan(input);
  if (!Array.isArray(value.candidates) || value.candidates.length !== 3) return fallbackPlan(input);
  const rawAnalyses = value.analyses;
  const analyses = Array.from({ length: input.sourceCount }, (_, sourceIndex) => {
    const matching = rawAnalyses.find((analysis) =>
      Boolean(analysis && typeof analysis === 'object' && (analysis as Record<string, unknown>).sourceIndex === sourceIndex),
    );
    return normalizeAnalysis(matching, sourceIndex);
  });
  if (analyses.some((analysis) => analysis === null)) return fallbackPlan(input);
  const candidates = value.candidates
    .map((candidate) => normalizeCandidate(candidate, input))
    .filter((candidate): candidate is CompositionCandidate => candidate !== null && Boolean(candidate.id));
  if (candidates.length === 0) return fallbackPlan(input);
  const selected = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
  return {
    origin: 'vision',
    aspectRatio: input.aspectRatio,
    analyses: analyses as CompositionSourceAnalysis[],
    candidates,
    selected,
    summary: boundedText(value.summary, selected.rationale, 280),
  };
};

export const buildCompositionPlannerPrompt = (rawInput: CompositionPlannerInput): string => {
  const input = normalizeInput(rawInput);
  const explicitRoles = input.roles
    .map((role, index) => role ? `SOURCE ${index + 1} must stay on the ${role}.` : null)
    .filter(Boolean)
    .join(' ');
  return `You are a senior cinematic composition planner. Analyze the attached source images before another image model combines them.

TARGET ASPECT RATIO: ${input.aspectRatio}
USER REQUEST: ${input.userPrompt}
SOURCES: ${input.sourceCount}, numbered in attachment order.
${explicitRoles || 'No explicit left/center/right locks were provided.'}

Infer visual weight, gaze direction, implied movement, lighting direction, identity-critical details, safe occlusion zones, subject scale, and how each silhouette should overlap. Prefer readable faces, intentional negative space, coherent perspective, depth separation, and a single clear focal hierarchy. Explicit source positions are hard constraints. Do not invent or swap identities.

Return JSON only, without markdown. It must contain:
{
  "analyses": [{"sourceIndex":0,"visualWeight":0.0,"gaze":"","motion":"","mustRemainVisible":[""],"safeToOcclude":[""],"lighting":""}],
  "candidates": [{"id":"","score":0,"camera":"","horizon":0.0,"rationale":"","placements":[{"sourceIndex":0,"role":"hero|support|atmosphere","box":[0,0,0,0],"depth":0.0,"zIndex":1,"focalPriority":1}]}],
  "selectedCandidateId":"",
  "summary":""
}

Provide exactly one analysis per source and exactly 3 candidates. Each candidate must contain every source exactly once. box uses normalized [x,y,width,height] coordinates in the final canvas, depth is 0 foreground to 1 background, zIndex is 1 backmost to ${input.sourceCount} frontmost, and focalPriority is 1 strongest to ${input.sourceCount} weakest. All zIndex and focalPriority values must be unique within a candidate.`;
};

const depthLabel = (depth: number): string =>
  depth <= 0.33 ? 'foreground' : depth <= 0.66 ? 'midground' : 'background';

const percent = (value: number): number => Math.round(value * 100);

export const formatCompositionPlan = (plan: CompositionPlan): string => {
  const selected = plan.selected;
  const sources = [...selected.placements]
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((placement) => {
      const analysis = plan.analyses[placement.sourceIndex];
      const [x, y, width, height] = placement.box;
      return `SOURCE ${placement.sourceIndex + 1}: ${placement.role}; ${depthLabel(placement.depth)}; box ${percent(x)}%,${percent(y)}% / ${percent(width)}%x${percent(height)}%; layer ${placement.zIndex}; focus ${placement.focalPriority}. Keep visible: ${analysis.mustRemainVisible.slice(0, 2).join(', ')}. Occlude only if needed: ${analysis.safeToOcclude.slice(0, 2).join(', ')}.`;
    })
    .join('\n');
  return `AI-SELECTED COMPOSITION PLAN (${selected.id}, ${plan.aspectRatio})
Camera: ${selected.camera}; horizon ${percent(selected.horizon)}%. ${plan.summary}
Do not swap identities, sides, focal priority, depth order, or layer order. Preserve recognizable faces, silhouettes, costume geometry, and source-specific lighting cues. Treat boxes as composition targets, not crop instructions; keep required details inside the frame.
${sources}`.slice(0, 1_799);
};
