export const DEFAULT_SYSTEM_PROMPT_CREATE =
`TASK: MASTER COMPOSITING — PHOTO-COMPOSITE, NOT RE-ILLUSTRATION.
The image model must treat SOURCE images as UNTOUCHABLE identity references.
RULES:
1. ZERO REDRAW / ZERO "IMPROVING": Do not repaint faces, skin, hair, eyes, or costumes. No beautification, no style drift.
2. COMPOSITE LIKE REAL PHOTO LAYERS: Only perspective warp, scale, blend edges, and relight onto ONE shared environment.
3. FIDELITY: Every emblem, armor plate, horn, and strand must match the corresponding SOURCE.
4. STYLE LOCK: Match the art style of the SOURCE card art (same brush feel); do not generic-paint new faces.
5. ENVIRONMENT: One new coherent background; light wraps BOTH characters consistently (no split-screen lighting).
6. NO COLLAGE: No visible seams, no duplicated horizons, no mismatched color grades left vs right.
7. GROUNDING: Contact shadows; feet on shared ground plane.`;

export const DEFAULT_SYSTEM_PROMPT_EDIT =
`TASK: SURGICAL REFINEMENT.
OBJECTIVE: Modify "BASE IMAGE" using "SOURCE CHARACTER" as FIXED ASSETS.
RULES:
1. ZERO REDRAWING: Faces, hair, eyes, and features MUST be 100% identical to source.
2. PIXEL-PERFECT: Use exact silhouettes. No new limbs or armor.
3. STYLE: VIBRANT FANTASY DIGITAL PAINTING (Hearthstone style).
4. INTEGRATION: Unified lighting, atmosphere, and contact shadows.
5. LIGHTING: Single dominant light source. Strong rim lighting.
6. COLOR: Match environment ambient light.
7. GROUNDING: Realistic shadows connected to feet.`;

export interface GenerationSettings {
  model: string;
  aspectRatio: "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9";
  imageSize: "512px" | "1K" | "2K" | "4K";
  prompt: string;
  negativePrompt?: string;
  batchSize: number;
  strictMode?: boolean;
  customSystemPromptCreate?: string;
  customSystemPromptEdit?: string;
}

export interface ImageSource {
  data: string;
  mimeType: string;
}

export type SceneRole = "left" | "center" | "right";

export type FusionSource = ImageSource & { role?: SceneRole };

export type CoverGenerationProgress = {
  done: number;
  total: number;
  phase: 'preparing' | 'generating' | 'strict' | 'finalizing';
};

export function sceneRolesOrder(plan: 2 | 3): SceneRole[] {
  return plan === 2 ? ["left", "right"] : ["left", "center", "right"];
}
