import type { GoogleGenAI } from "@google/genai";
import { MODELS_SUPPORTING_IMAGE_SIZE, normalizeGeminiImageSettings } from "../constants";
import { CHATGPT_IMAGE_MODEL, MAX_CHATGPT_IMAGE_REFERENCES, createChatGPTImageGenerator, prepareImageReferences, type ChatGPTImageReference } from "./chatgptImages";
import { buildCompositionPlannerPrompt, formatCompositionPlan, resolveCompositionPlan, type CompositionPlan } from "./compositionPlanner";
import { createGeminiClient } from "./geminiClient";
import { compositeExactArtScene, preflightExactArtRaster, validateExactArtRaster } from "./exactArtComposer";
import { generateOpenRouterImage, getOpenRouterModel, isOpenRouterImageModel, type OpenRouterImageReference } from "./openRouterImages";
import { composeOpenRouterReferenceSheet } from "./openRouterReferenceComposer";
import { prepareSubjectLayers } from "./subjectLayer";
import {
  DEFAULT_SYSTEM_PROMPT_CREATE,
  DEFAULT_SYSTEM_PROMPT_EDIT,
  type FusionSource,
  type GenerationSettings,
  type ImageSource,
  type SceneRole,
} from "./generationContracts";

export {
  DEFAULT_SYSTEM_PROMPT_CREATE,
  DEFAULT_SYSTEM_PROMPT_EDIT,
  sceneRolesOrder,
} from "./generationContracts";
export type {
  CoverGenerationProgress,
  FusionSource,
  GenerationSettings,
  ImageSource,
  SceneRole,
} from "./generationContracts";
import type { CoverGenerationProgress } from "./generationContracts";

/** Multimodal vision for composition / QA (not the image generator). */
const VISION_MODEL = "gemini-3.1-flash-lite-preview";
const COMPOSITION_PLANNER_TIMEOUT_MS = 8_000;
const MAX_REMOTE_IMAGE_BYTES = 32 * 1024 * 1024;

function fusionSourceLabel(src: FusionSource, indexZeroBased: number): string {
  const r = src.role;
  if (r === "left") {
    return "SOURCE CHARACTER — LEFT (final frame: occupy the LEFT third or left half; anchor figure in left area) (USE THIS EXACTLY):";
  }
  if (r === "center") {
    return "SOURCE CHARACTER — CENTER (final frame: occupy the CENTER third; anchor figure in middle) (USE THIS EXACTLY):";
  }
  if (r === "right") {
    return "SOURCE CHARACTER — RIGHT (final frame: occupy the RIGHT third or right half; anchor figure in right area) (USE THIS EXACTLY):";
  }
  return `SOURCE CHARACTER ${indexZeroBased + 1} (USE THIS EXACTLY):`;
}

function fusionSourceVisionTag(src: FusionSource, indexZeroBased: number): string {
  const r = src.role;
  if (r === "left") return "SOURCE (LEFT — must appear on LEFT in output):";
  if (r === "center") return "SOURCE (CENTER — must appear in CENTER in output):";
  if (r === "right") return "SOURCE (RIGHT — must appear on RIGHT in output):";
  return `SOURCE ${indexZeroBased + 1}:`;
}

function sceneLayoutBlock(sources: FusionSource[]): string {
  const roles = sources.map((s) => s.role).filter(Boolean) as SceneRole[];
  if (roles.length === 0) return "";
  const hasAllThree = roles.includes("left") && roles.includes("center") && roles.includes("right");
  const hasTwo = roles.includes("left") && roles.includes("right") && !roles.includes("center");
  if (hasAllThree) {
    return `
    SCENE LAYOUT (mandatory — user-defined staging):
    - Place the LEFT source character in the left third of the frame (foreground or midground as fits).
    - Place the CENTER source character in the center third.
    - Place the RIGHT source character in the right third.
    - Maintain clear left-to-right reading order; do not swap which identity goes where.
    - Single shared environment and unified lighting across all three.`;
  }
  if (hasTwo) {
    return `
    SCENE LAYOUT (mandatory — user-defined staging):
    - Place the LEFT source character in the left half (or left third) of the frame.
    - Place the RIGHT source character in the right half (or right third) of the frame.
    - Do not place both on the same side. Single shared environment; unified lighting.`;
  }
  return "";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\s*|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function dataUrlToImageSource(dataUrl: string): ImageSource {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  return { data: match[2], mimeType: match[1] };
}

/** Limit parallel vision QA + refine calls in strict mode (429 / instability). */
const STRICT_VISION_CONCURRENCY = 2;

function optionalGeminiReferenceLimit(model: string, requiredImages: number, desiredOptional: number): number {
  // Gemini 2.5 is documented to work best with no more than three input
  // images. Required sources/output are retained; optional likes yield first.
  return model === "gemini-2.5-flash-image"
    ? Math.max(0, 3 - requiredImages)
    : desiredOptional;
}

/**
 * Favorite / benchmark image URL → Gemini inlineData payload.
 * Supports data URLs and http(s) public URLs from the Cover service.
 */
function throwIfImageHydrationAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Image loading was cancelled.', 'AbortError');
}

async function readBoundedImageResponse(response: Response, signal?: AbortSignal): Promise<Blob> {
  throwIfImageHydrationAborted(signal);
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REMOTE_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Изображение слишком большое для безопасной загрузки.');
  }

  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!mimeType?.startsWith('image/')) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Сервер вернул не изображение.');
  }

  const reader = response.body?.getReader();
  if (!reader) return new Blob([], { type: mimeType });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      throwIfImageHydrationAborted(signal);
      const { done, value } = await reader.read();
      throwIfImageHydrationAborted(signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REMOTE_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Изображение слишком большое для безопасной загрузки.');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([combined.buffer], { type: mimeType });
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  throwIfImageHydrationAborted(signal);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      const reason = signal?.reason instanceof Error
        ? signal.reason
        : new DOMException('Image loading was cancelled.', 'AbortError');
      if (reader.readyState === FileReader.LOADING) reader.abort();
      fail(reason);
    };
    reader.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(String(reader.result));
    };
    reader.onerror = () => fail(reader.error ?? new Error('FileReader'));
    reader.onabort = () => fail(new DOMException('Image loading was cancelled.', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

export async function likedUrlToInlineData(
  likedUrl: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string } | null> {
  throwIfImageHydrationAborted(signal);
  const dataMatch = likedUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (dataMatch) {
    return { data: dataMatch[2], mimeType: dataMatch[1] };
  }
  if (likedUrl.startsWith("/") || likedUrl.startsWith("http://") || likedUrl.startsWith("https://")) {
    try {
      const res = signal ? await fetch(likedUrl, { signal }) : await fetch(likedUrl);
      if (!res.ok) return null;
      const blob = await readBoundedImageResponse(res, signal);
      const dataUrl = await blobToDataUrl(blob, signal);
      const m = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (!m) return null;
      return { data: m[2], mimeType: m[1] };
    } catch (e) {
      if (signal?.aborted) throwIfImageHydrationAborted(signal);
      if (e instanceof Error && e.message.includes('слишком большое')) throw e;
      console.error("likedUrlToInlineData", e);
      return null;
    }
  }
  return null;
}

const REFERENCE_VISION_PROMPT = `You are a vision analyst for a fantasy card-cover compositing pipeline. Analyze this REFERENCE IMAGE as a composition template (other characters will be substituted later).

Output ONLY valid JSON (no markdown, no code fences). Use this exact shape:
{
  "subjects": [
    {
      "label": "subject_1",
      "position_2d": "left|center|right and upper|mid|lower",
      "depth_layer": "foreground|midground|background",
      "scale_vs_frame": "small|medium|large relative to frame",
      "pose_summary": "short English phrase"
    }
  ],
  "environment": {
    "type": "e.g. cave, battlefield, sky, interior",
    "ground_plane": "visible|implied|none",
    "horizon": "high|mid|low|none",
    "key_background_elements": ["short English", "..."]
  },
  "spatial_depth": {
    "overlaps": "who overlaps whom / atmospheric perspective",
    "camera": "eye level|low|high, focal feel wide|normal|tele",
    "depth_cues": "overlap, size gradient, fog, etc."
  },
  "lighting": {
    "key_direction": "e.g. from upper left",
    "contrast": "low|medium|high",
    "shadow_placement": "short note"
  },
  "compositor_instructions": [
    "3-6 imperative English lines: what to replicate in layout (positions, depth, camera), not colors or character identity"
  ]
}

Rules:
- Describe spatial layout, depth, and light so a compositor can place NEW characters into the SAME structure.
- Do NOT require copying exact colors, text, logos, or fine art style from this template.
- If you count figures, use subjects[] entries; allow empty array only if there are zero clear figures (then explain environment only).`;

/**
 * Deep composition + depth analysis for a saved reference image (Gemini multimodal vision).
 * Returns JSON string or raw model text if JSON parsing fails downstream.
 */
export async function analyzeReferenceCompositionVision(image: ImageSource): Promise<string> {
  const ai = await createGeminiClient();
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: {
        parts: [
          { text: REFERENCE_VISION_PROMPT },
          {
            inlineData: {
              data: image.data.split(",")[1] || image.data,
              mimeType: image.mimeType,
            },
          },
        ],
      },
    });
    const text = (res.text || "").trim();
    return text || "{}";
  } catch (e) {
    console.error("analyzeReferenceCompositionVision", e);
    throw e;
  }
}

const FAVORITE_CHOICE_VISION_PROMPT = `You are a vision analyst for a fantasy card-cover / character fusion pipeline.

The user added ONE image to "favorites". It may be one of several parallel batch variants from the same generation (same prompt family). Images are provided in order: first = CHOSEN (favorite), then REJECTED alternatives (if any).

Task:
- Infer plausible, evidence-based reasons why a viewer might prefer the CHOSEN image over the alternatives.
- Compare composition, depth (layering, overlaps), lighting unity, character readability (faces, silhouette), integration with background, artifact level, and overall "card cover" impact.
- Use cautious wording: "likely", "may", "tends to" — you cannot know the user's true intent.
- If there are NO alternative images, still analyze strengths of the chosen image (summary only).

Output ONLY valid JSON (no markdown, no code fences). Shape:
{
  "summary_ru": "2-4 sentences in Russian",
  "likely_reasons_ru": ["short bullet in Russian", "..."],
  "vs_others_ru": "1-3 sentences comparing chosen vs rejected; empty string if no alternatives"
}`;

/**
 * Explains likely reasons the user favored one variant over parallel batch alternatives (Gemini vision).
 * Returns JSON text (or model text if parsing fails downstream).
 */
export async function analyzeFavoriteChoiceVision(
  chosen: ImageSource,
  alternatives: ImageSource[],
  options?: { userPromptHint?: string }
): Promise<string> {
  const ai = await createGeminiClient();
  const hint = options?.userPromptHint?.trim();
  const parts: any[] = [
    {
      text:
        FAVORITE_CHOICE_VISION_PROMPT +
        (hint ? `\nOptional user prompt/theme hint (may be empty): ${hint}` : "") +
        `\n\nOrder: image 1 = CHOSEN. Images 2+ = rejected batch variants (same count as provided).`,
    },
    { text: "CHOSEN (favorite):" },
    {
      inlineData: {
        data: chosen.data.split(",")[1] || chosen.data,
        mimeType: chosen.mimeType,
      },
    },
  ];
  alternatives.forEach((alt, idx) => {
    parts.push({ text: `Rejected variant ${idx + 1}:` });
    parts.push({
      inlineData: {
        data: alt.data.split(",")[1] || alt.data,
        mimeType: alt.mimeType,
      },
    });
  });
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: { parts },
    });
    return (res.text || "").trim() || "{}";
  } catch (e) {
    console.error("analyzeFavoriteChoiceVision", e);
    throw e;
  }
}


const FAVORITE_VIDEO_CHOICE_VISION_PROMPT = `You are a vision analyst for AI-generated short VIDEO clips (Veo / image-to-video).

The user added ONE video to favorites. It may be one of several variants from the same batch. Still frames are provided in order: first = CHOSEN (favorite), then REJECTED alternatives (if any). Each frame is an approximate first-frame snapshot of the clip.

Task:
- Infer plausible reasons the user might prefer the CHOSEN clip: motion subtlety, loop feel, stability (no zoom/pan if intended), artifact level, atmosphere, faithfulness to the original illustration.
- Use cautious wording: "likely", "may", "tends to".
- If there are NO alternatives, still summarize strengths of the chosen clip.

Output ONLY valid JSON (no markdown, no code fences). Shape:
{
  "summary_ru": "2-4 sentences in Russian",
  "likely_reasons_ru": ["short bullet in Russian", "..."],
  "vs_others_ru": "1-3 sentences comparing chosen vs rejected; empty string if no alternatives"
}`;

/**
 * Explains likely reasons the user favored one video variant over batch alternatives (Gemini vision on first frames).
 */
export async function analyzeFavoriteVideoChoiceVision(
  chosen: ImageSource,
  alternatives: ImageSource[],
  options?: { userPromptHint?: string }
): Promise<string> {
  const ai = await createGeminiClient();
  const hint = options?.userPromptHint?.trim();
  const parts: any[] = [
    {
      text:
        FAVORITE_VIDEO_CHOICE_VISION_PROMPT +
        (hint ? "\nOptional user prompt/theme hint (may be empty): " + hint : "") +
        "\n\nOrder: frame 1 = CHOSEN favorite (video). Frames 2+ = rejected batch variants (same count as provided).",
    },
    { text: "CHOSEN (favorite video, first frame):" },
    {
      inlineData: {
        data: chosen.data.split(",")[1] || chosen.data,
        mimeType: chosen.mimeType,
      },
    },
  ];
  alternatives.forEach((alt, idx) => {
    parts.push({ text: "Rejected variant " + (idx + 1) + " (first frame):" });
    parts.push({
      inlineData: {
        data: alt.data.split(",")[1] || alt.data,
        mimeType: alt.mimeType,
      },
    });
  });
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: { parts },
    });
    return (res.text || "").trim() || "{}";
  } catch (e) {
    console.error("analyzeFavoriteVideoChoiceVision", e);
    throw e;
  }
}

async function planFusionComposition(
  sources: FusionSource[],
  settings: GenerationSettings,
  existingClient?: GoogleGenAI,
  signal?: AbortSignal,
): Promise<CompositionPlan> {
  const input = {
    sourceCount: sources.length,
    aspectRatio: settings.aspectRatio,
    roles: sources.map(({ role }) => role),
    userPrompt: settings.prompt,
  };
  const controller = new AbortController();
  const onUserAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onUserAbort();
  else signal?.addEventListener('abort', onUserAbort, { once: true });
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException('Composition planning deadline exceeded.', 'TimeoutError'));
  }, COMPOSITION_PLANNER_TIMEOUT_MS);
  const abortable = <T>(promise: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          controller.signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  };
  const throwIfPlannerAborted = () => controller.signal.throwIfAborted();
  try {
    throwIfPlannerAborted();
    const work = (async () => {
      throwIfPlannerAborted();
      const ai = existingClient ?? await createGeminiClient();
      throwIfPlannerAborted();
      const normalizedSources = await Promise.all(
        sources.map((source) => normalizeImageSource(source, controller.signal)),
      );
      throwIfPlannerAborted();
      const parts: any[] = [{ text: buildCompositionPlannerPrompt(input) }];
      normalizedSources.forEach((source, index) => {
        parts.push({ text: fusionSourceVisionTag(sources[index], index) });
        parts.push({ inlineData: source });
      });
      const response = await ai.models.generateContent({
        model: VISION_MODEL,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          abortSignal: controller.signal,
        },
      });
      return response?.text || '';
    })();
    const raw = await abortable(work);
    return resolveCompositionPlan(raw, input);
  } catch {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Генерация отменена.', 'AbortError');
    }
    console.warn('Composition vision unavailable; using deterministic layout.');
    return resolveCompositionPlan('', input);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onUserAbort);
  }
}

/** Vision QA: compare OUTPUT to sources; request JSON. */
async function visionCheckFusionOutput(
  ai: GoogleGenAI,
  sources: FusionSource[],
  outputDataUrl: string,
  compositionPlan: CompositionPlan | null,
): Promise<{ pass: boolean; issues: string[] }> {
  let output: ImageSource;
  try {
    output = dataUrlToImageSource(outputDataUrl);
  } catch {
    return { pass: true, issues: [] };
  }
  const parts: any[] = [
    {
      text: `Strict QC: SOURCE images (order) vs OUTPUT. One combined scene expected.
Check: (1) identity vs each SOURCE (2) single environment (3) unified lighting (4) intended source side, scale, overlap, focal priority, and front-to-back order.
${compositionPlan ? `EXPECTED PLAN:\n${formatCompositionPlan(compositionPlan)}` : ''}
JSON only, no markdown: {"pass":true|false,"issues":["English",...]}
pass=false if redrawn/unrecognizable vs SOURCE, obvious collage, swapped source positions, or materially wrong depth/layer order.`,
    },
  ];
  sources.forEach((src, idx) => {
    parts.push({ text: fusionSourceVisionTag(src, idx) });
    parts.push({
      inlineData: {
        data: src.data.split(",")[1] || src.data,
        mimeType: src.mimeType,
      },
    });
  });
  parts.push({ text: "OUTPUT (candidate):" });
  parts.push({
    inlineData: {
      data: output.data.split(",")[1] || output.data,
      mimeType: output.mimeType,
    },
  });
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: { parts },
    });
    const parsed = extractJsonObject(res.text || "");
    if (!parsed) return { pass: true, issues: [] };
    const pass = typeof parsed.pass === "boolean" ? parsed.pass : true;
    const raw = parsed.issues;
    const issues = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string")
      : [];
    return { pass, issues };
  } catch (e) {
    console.error("visionCheckFusionOutput", e);
    return { pass: true, issues: [] };
  }
}

/** One refinement pass: treat failed output as base; fix only QA issues. */
async function refineFusionAfterVision(
  ai: GoogleGenAI,
  model: string,
  settings: GenerationSettings,
  sources: FusionSource[],
  failedDataUrl: string,
  issues: string[],
  likedImages: string[],
  compositionPlan: CompositionPlan | null,
): Promise<string | null> {
  const base = dataUrlToImageSource(failedDataUrl);
  const parts: any[] = [];

  sources.forEach((src, idx) => {
    const head = src.role
      ? `SOURCE CHARACTER — ${src.role.toUpperCase()} (ABSOLUTE REFERENCE — DO NOT REDRAW OR REINTERPRET):`
      : `SOURCE CHARACTER ${idx + 1} (ABSOLUTE REFERENCE — DO NOT REDRAW OR REINTERPRET):`;
    parts.push({ text: head });
    parts.push({
      inlineData: {
        data: src.data.split(",")[1] || src.data,
        mimeType: src.mimeType,
      },
    });
  });

  parts.push({ text: "BASE IMAGE (FAILED QA — SURGICAL FIX ONLY):" });
  parts.push({
    inlineData: {
      data: base.data.split(",")[1] || base.data,
      mimeType: base.mimeType,
    },
  });

  if (likedImages.length > 0) {
    parts.push({
      text: "QUALITY BENCHMARKS (style only, not identity):",
    });
    const optionalReferenceLimit = optionalGeminiReferenceLimit(model, sources.length + 1, 2);
    for (const likedUrl of likedImages.slice(0, optionalReferenceLimit)) {
      const inline = await likedUrlToInlineData(likedUrl);
      if (inline) {
        parts.push({
          inlineData: { data: inline.data, mimeType: inline.mimeType },
        });
      }
    }
  }

  const issueText = issues.length ? issues.join(" | ") : "unify scene and lighting";
  const fixPrompt = `TASK: VISION QA REJECTED THIS OUTPUT.
PROBLEMS REPORTED: ${issueText}

RULES:
1) ZERO REDRAWING: Faces, hair, eyes, armor, and props must match SOURCE CHARACTER images exactly — like texture projection, not repainting.
2) Fix ONLY: environment continuity, global lighting harmony, contact shadows, color grading — without changing character designs.
3) NO "improving" or beautifying faces. NO new poses for characters.
4) Single coherent background; no collage seams.
${compositionPlan ? `5) Restore the intended position, scale, overlap, and depth:\n${formatCompositionPlan(compositionPlan)}` : ''}
${settings.prompt ? `USER NOTE (secondary): ${settings.prompt}` : ""}
${settings.negativePrompt ? `AVOID: ${settings.negativePrompt}` : ""}`;

  parts.push({ text: fixPrompt });

  const imageConfig: any = { aspectRatio: settings.aspectRatio };
  if (MODELS_SUPPORTING_IMAGE_SIZE.has(model)) {
    imageConfig.imageSize = settings.imageSize;
  }

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: { imageConfig },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

export type CoverGenerationResultHandler = (imageUrl: string) => void | Promise<void>;

function chatGPTFusionPrompt(
  settings: GenerationSettings,
  sources: FusionSource[],
  hasBaseImage: boolean,
  hasReference: boolean,
  qualityExampleCount: number,
  referenceCompositionNotes: string | null,
  compositionPlan: CompositionPlan | null,
  variant: number,
): string {
  const customPrompt = hasBaseImage
    ? settings.customSystemPromptEdit?.trim()
    : settings.customSystemPromptCreate?.trim();
  const defaultPrompt = hasBaseImage ? DEFAULT_SYSTEM_PROMPT_EDIT : DEFAULT_SYSTEM_PROMPT_CREATE;
  const sourceRoles = sources.map((source, index) => `- ${fusionSourceLabel(source, index).replace(/\s*\(USE THIS EXACTLY\):$/, '')}`).join('\n');
  let imageNumber = 1;
  const referenceOrder = sources.map((source, index) => `Image ${imageNumber++}: ${fusionSourceLabel(source, index).replace(/\s*\(USE THIS EXACTLY\):$/, '')}`);
  if (hasReference) referenceOrder.push(`Image ${imageNumber++}: COMPOSITION REFERENCE (spatial/framing guidance only)`);
  if (hasBaseImage) referenceOrder.push(`Image ${imageNumber++}: BASE IMAGE TO REFINE`);
  for (let index = 0; index < qualityExampleCount; index++) referenceOrder.push(`Image ${imageNumber++}: OPTIONAL QUALITY EXAMPLE`);
  return `${customPrompt || defaultPrompt}

IMPORTANT: Preserve the supplied character identities, faces, costumes, silhouettes, and readable details. Do not redraw, beautify, mutate, duplicate, or swap them. Integrate them into one coherent fantasy cover with unified lighting and no collage seams.
DESIRED ASPECT RATIO: ${settings.aspectRatio}. This is a composition target; exact output dimensions are not guaranteed.
${sourceRoles ? `SOURCE PLACEMENT:\n${sourceRoles}` : ''}
${referenceOrder.length ? `REFERENCE IMAGE ORDER (exact request order):\n${referenceOrder.join('\n')}` : ''}
${hasBaseImage ? 'A BASE IMAGE is included: refine its composition while retaining supplied source identities.' : ''}
${hasReference ? 'A COMPOSITION REFERENCE is included: use only its spatial/framing guidance, not its characters, text, logos, or palette.' : ''}
${referenceCompositionNotes?.trim() ? `COMPOSITION NOTES:\n${referenceCompositionNotes.trim()}` : ''}
${compositionPlan ? formatCompositionPlan(compositionPlan) : ''}
${settings.strictMode ? 'STRICT IDENTITY MODE: prioritize source identity fidelity. Automated vision QA is unavailable for this model.' : ''}
${settings.prompt.trim() ? `USER REQUEST: ${settings.prompt.trim()}` : ''}
${settings.negativePrompt?.trim() ? `AVOID: ${settings.negativePrompt.trim()}` : 'AVOID: redrawing, changing faces, mutations, extra limbs, collage, split-screen.'}
${settings.batchSize > 1 ? `VARIANT ${variant} of ${settings.batchSize}: vary only camera framing or background rhythm; preserve all source identities.` : ''}`;
}

async function generateChatGPTFusedCover(
  sources: FusionSource[],
  reference: ImageSource | null,
  settings: GenerationSettings,
  baseImage: ImageSource | null,
  likedImages: string[],
  referenceCompositionNotes: string | null,
  onProgress?: (p: CoverGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 4) {
    throw new Error('Для GPT Image доступен пакет от 1 до 4 вариантов.');
  }
  const requiredImages = [
    ...sources,
    ...(reference ? [reference] : []),
    ...(baseImage ? [baseImage] : []),
  ];
  if (requiredImages.length > MAX_CHATGPT_IMAGE_REFERENCES) {
    throw new Error(`Выбранные источники, база и референс превышают лимит ${MAX_CHATGPT_IMAGE_REFERENCES} изображений GPT Image.`);
  }

  onProgress?.({ done: 0, total: settings.batchSize, phase: 'preparing' });
  const compositionPlan = baseImage ? null : await planFusionComposition(sources, settings, undefined, signal);
  const normalizedSources = await Promise.all(sources.map((source) => normalizeImageSource(source, signal)));
  const normalizedReference = reference ? await normalizeImageSource(reference, signal) : null;
  const normalizedBaseImage = baseImage ? await normalizeImageSource(baseImage, signal) : null;
  // Labels stay in the prompt; the API accepts the compact image shape only.
  const references: ChatGPTImageReference[] = normalizedSources.map(({ data, mimeType }) => ({ data, mimeType }));

  if (normalizedReference) references.push(normalizedReference);
  if (normalizedBaseImage) references.push(normalizedBaseImage);

  // Likes are optional quality examples. Required source/base/reference images are
  // never displaced; the UI can surface that excess likes were not sent to GPT.
  for (const likedUrl of likedImages) {
    if (references.length >= MAX_CHATGPT_IMAGE_REFERENCES) break;
    const inline = await likedUrlToInlineData(likedUrl, signal);
    if (inline) references.push(inline);
  }

  const results: string[] = [];
  const generateImage = await createChatGPTImageGenerator(references, signal);
  onProgress?.({ done: 0, total: settings.batchSize, phase: 'generating' });
  for (let index = 0; index < settings.batchSize; index++) {
    results.push(await generateImage(
      chatGPTFusionPrompt(settings, sources, Boolean(normalizedBaseImage), Boolean(normalizedReference), references.length - normalizedSources.length - Number(Boolean(normalizedReference)) - Number(Boolean(normalizedBaseImage)), referenceCompositionNotes, compositionPlan, index + 1),
    ));
    onProgress?.({ done: index + 1, total: settings.batchSize, phase: 'generating' });
  }
  return results;
}

async function generateOpenRouterFusedCover(
  sources: FusionSource[],
  reference: ImageSource | null,
  settings: GenerationSettings,
  baseImage: ImageSource | null,
  likedImages: string[],
  referenceCompositionNotes: string | null,
  onProgress?: (p: CoverGenerationProgress) => void,
  signal?: AbortSignal,
  onResult?: CoverGenerationResultHandler,
): Promise<string[]> {
  const model = getOpenRouterModel(settings.model);
  if (!model || !isOpenRouterImageModel(settings.model) || !model.coverCompatible) {
    throw new Error('Эта модель OpenRouter пока несовместима с редактором Cover.');
  }
  if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 4) {
    throw new Error('Для OpenRouter доступен пакет от 1 до 4 вариантов.');
  }
  const requiredImages = [
    ...sources,
    ...(reference ? [reference] : []),
    ...(baseImage ? [baseImage] : []),
  ];
  if (model.referenceStrategy !== 'contact-sheet' && requiredImages.length > model.maxReferences) {
    throw new Error(`${model.name} принимает не больше ${model.maxReferences} изображений вместе с референсом и основой.`);
  }
  if (model.aspectRatios.length > 0 && !(model.aspectRatios as readonly string[]).includes(settings.aspectRatio)) {
    throw new Error(`${model.name} не поддерживает выбранный формат.`);
  }
  if (model.resolutions.length > 0 && !(model.resolutions as readonly string[]).includes(settings.imageSize)) {
    throw new Error(`${model.name} не поддерживает выбранное разрешение.`);
  }

  onProgress?.({ done: 0, total: settings.batchSize, phase: 'preparing' });
  const compositionPlan = baseImage ? null : await planFusionComposition(sources, settings, undefined, signal);
  const normalizedSources = await Promise.all(sources.map((source) => normalizeImageSource(source, signal)));
  const normalizedReference = reference ? await normalizeImageSource(reference, signal) : null;
  const normalizedBaseImage = baseImage ? await normalizeImageSource(baseImage, signal) : null;
  let references: OpenRouterImageReference[] = normalizedSources.map(({ data, mimeType }) => ({
    data,
    mimeType: mimeType as OpenRouterImageReference['mimeType'],
  }));
  if (normalizedReference) references.push(normalizedReference as OpenRouterImageReference);
  if (normalizedBaseImage) references.push(normalizedBaseImage as OpenRouterImageReference);

  if (model.referenceStrategy === 'contact-sheet') {
    const panels = [
      ...normalizedSources.map((source, index) => ({ label: `SOURCE ${index + 1}`, reference: source as OpenRouterImageReference })),
      ...(normalizedReference ? [{ label: 'COMPOSITION', reference: normalizedReference as OpenRouterImageReference }] : []),
      ...(normalizedBaseImage ? [{ label: 'BASE', reference: normalizedBaseImage as OpenRouterImageReference }] : []),
    ];
    references = [await composeOpenRouterReferenceSheet(panels, signal, {
      maxBytes: model.maxReferenceBytes,
    })];
  } else {
    for (const likedUrl of likedImages) {
      if (references.length >= model.maxReferences) break;
      const inline = await likedUrlToInlineData(likedUrl, signal);
      if (inline) references.push(inline as OpenRouterImageReference);
    }
    // OpenRouter enforces 10 MiB per image and 24 MiB combined. Reuse the
    // browser-side optimizer so only the request copy is resized; sources kept
    // in the editor, history, and storage remain byte-for-byte unchanged.
    references = await prepareImageReferences(references, signal) as OpenRouterImageReference[];
  }

  const optionalExampleCount = model.referenceStrategy === 'contact-sheet'
    ? 0
    : references.length - normalizedSources.length - Number(Boolean(normalizedReference)) - Number(Boolean(normalizedBaseImage));
  const contactSheetPrompt = model.referenceStrategy === 'contact-sheet'
    ? '\n\nINPUT PACKAGING — CONTACT SHEET: The single reference image contains labeled panels. Treat every SOURCE panel as a separate identity reference, COMPOSITION as layout guidance, and BASE as the editable base. Every source is shown fully without cropping; preserve the complete subjects and do not merge identities.'
    : '';
  const results: string[] = [];
  onProgress?.({ done: 0, total: settings.batchSize, phase: 'generating' });
  for (let index = 0; index < settings.batchSize; index++) {
    results.push(await generateOpenRouterImage({
      model: settings.model,
      prompt: chatGPTFusionPrompt(
        settings,
        sources,
        Boolean(normalizedBaseImage),
        Boolean(normalizedReference),
        optionalExampleCount,
        referenceCompositionNotes,
        compositionPlan,
        index + 1,
      ) + contactSheetPrompt,
      references,
      ...(model.aspectRatios.length > 0 ? { aspectRatio: settings.aspectRatio } : {}),
      ...(model.resolutions.length > 0 && settings.imageSize !== '512px'
        ? { resolution: settings.imageSize }
        : {}),
    }, signal, {
      onResult: async (imageUrl) => {
        onProgress?.({ done: index, total: settings.batchSize, phase: 'finalizing' });
        await onResult?.(imageUrl);
      },
    }));
    onProgress?.({ done: index + 1, total: settings.batchSize, phase: 'generating' });
  }
  return results;
}

function backgroundPlatePrompt(
  settings: GenerationSettings,
  plan: CompositionPlan,
  hasReference: boolean,
  referenceCompositionNotes: string | null,
  variant: number,
) {
  const reservedRegions = [...plan.selected.placements]
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((placement) => {
      const [x, y, width, height] = placement.box.map((value) => Math.round(value * 100));
      return `- Region ${placement.sourceIndex + 1}: x ${x}%, y ${y}%, width ${width}%, height ${height}%; depth ${Math.round(placement.depth * 100)}%; layer ${placement.zIndex}.`;
    })
    .join('\n');
  return `BACKGROUND PLATE ONLY — this image will receive protected source-art layers later.
Create one complete, coherent environment. Fill the whole frame with purposeful scenery, foreground details, depth, atmosphere, and a readable ground plane; do not leave a flat or empty central void.
Absolutely no characters, people, creatures, bodies, faces, limbs, armor, portraits, statues, silhouettes, or humanoid shadows. Do not paint placeholders inside the reserved subject regions.
Keep the planned subject regions visually unoccupied while continuing the environment naturally behind them. Establish one horizon, one camera, and one shared lighting direction so later subject layers feel grounded.
TARGET ASPECT RATIO: ${settings.aspectRatio}.
CAMERA: ${plan.selected.camera}; HORIZON: ${Math.round(plan.selected.horizon * 100)}%.
RESERVED REGIONS (coordinates only; do not draw occupants):
${reservedRegions}
ENVIRONMENT REQUEST: ${settings.prompt.trim() || 'A cinematic fantasy environment suitable for a commercial cover.'}
${settings.negativePrompt?.trim() ? `ALSO AVOID: ${settings.negativePrompt.trim()}.` : ''}
${hasReference ? 'The attached image is a spatial composition reference only. Copy neither its characters nor its text, logos, or protected artwork.' : ''}
${referenceCompositionNotes?.trim() ? `SPATIAL NOTES: ${referenceCompositionNotes.trim()}` : ''}
VARIANT ${variant}: vary only environmental rhythm, camera distance, and atmospheric depth.`;
}

function validateExactArtProvider(
  settings: GenerationSettings,
  reference: ImageSource | null,
) {
  if (!isOpenRouterImageModel(settings.model)) return;
  const model = getOpenRouterModel(settings.model);
  if (!model || !model.coverCompatible) {
    throw new Error('Эта модель OpenRouter пока несовместима с редактором Cover.');
  }
  if (model.aspectRatios.length > 0 && !(model.aspectRatios as readonly string[]).includes(settings.aspectRatio)) {
    throw new Error(`${model.name} не поддерживает выбранный формат.`);
  }
  if (model.resolutions.length > 0 && !(model.resolutions as readonly string[]).includes(settings.imageSize)) {
    throw new Error(`${model.name} не поддерживает выбранное разрешение.`);
  }
  if (settings.model === 'recraft/recraft-v4-styles-pro' && !reference) {
    throw new Error('Для защищённой композиции Recraft V4 нужен референс композиции.');
  }
}

async function prepareExactArtReference(
  settings: GenerationSettings,
  reference: ImageSource | null,
  signal?: AbortSignal,
): Promise<ImageSource | null> {
  if (!reference) return null;
  if (isOpenRouterImageModel(settings.model)) {
    const model = getOpenRouterModel(settings.model);
    if (!model) throw new Error('Эта модель OpenRouter пока несовместима с редактором Cover.');
    if (model.referenceStrategy === 'contact-sheet') {
      return composeOpenRouterReferenceSheet([{
        label: 'COMPOSITION',
        reference: reference as OpenRouterImageReference,
      }], signal, { maxBytes: model.maxReferenceBytes });
    }
  }
  const [prepared] = await prepareImageReferences([reference], signal);
  return prepared;
}

async function generateBackgroundPlates(
  settings: GenerationSettings,
  plan: CompositionPlan,
  reference: ImageSource | null,
  referenceCompositionNotes: string | null,
  signal?: AbortSignal,
  onBackgroundComplete?: (background: string, index: number) => Promise<string>,
): Promise<Array<{ background: string; completedResult?: string }>> {
  const prompts = Array.from({ length: settings.batchSize }, (_, index) =>
    backgroundPlatePrompt(settings, plan, Boolean(reference), referenceCompositionNotes, index + 1));

  if (settings.model === CHATGPT_IMAGE_MODEL) {
    const generate = await createChatGPTImageGenerator(reference ? [reference] : [], signal);
    const results: Array<{ background: string; completedResult?: string }> = [];
    for (let index = 0; index < prompts.length; index += 1) {
      signal?.throwIfAborted();
      const background = await generate(prompts[index]);
      const completedResult = onBackgroundComplete
        ? await onBackgroundComplete(background, index)
        : undefined;
      results.push({ background, completedResult });
    }
    return results;
  }

  if (isOpenRouterImageModel(settings.model)) {
    validateExactArtProvider(settings, reference);
    const model = getOpenRouterModel(settings.model);
    if (!model) throw new Error('Эта модель OpenRouter пока несовместима с редактором Cover.');
    const references = reference ? [reference as OpenRouterImageReference] : [];
    const results: Array<{ background: string; completedResult?: string }> = [];
    for (let index = 0; index < prompts.length; index += 1) {
      signal?.throwIfAborted();
      let completedResult: string | undefined;
      const background = await generateOpenRouterImage({
        model: settings.model,
        prompt: prompts[index],
        references,
        ...(model.aspectRatios.length > 0 ? { aspectRatio: settings.aspectRatio } : {}),
        ...(model.resolutions.length > 0 && settings.imageSize !== '512px'
          ? { resolution: settings.imageSize }
          : {}),
      }, signal, onBackgroundComplete ? {
        onResult: async (imageUrl) => {
          completedResult = await onBackgroundComplete(imageUrl, index);
        },
      } : {});
      results.push({ background, completedResult });
    }
    return results;
  }

  const normalizedSettings = {
    ...settings,
    ...normalizeGeminiImageSettings(settings.model, settings.imageSize, settings.aspectRatio),
  } as GenerationSettings;
  const ai = await createGeminiClient();
  const results: Array<{ background: string; completedResult?: string }> = [];
  for (let index = 0; index < prompts.length; index += 1) {
    signal?.throwIfAborted();
    const parts: any[] = [{ text: prompts[index] }];
    if (reference) {
      parts.push({
        inlineData: {
          data: reference.data,
          mimeType: reference.mimeType,
        },
      });
    }
    const imageConfig: any = { aspectRatio: normalizedSettings.aspectRatio };
    if (MODELS_SUPPORTING_IMAGE_SIZE.has(normalizedSettings.model)) {
      imageConfig.imageSize = normalizedSettings.imageSize;
    }
    const response = await ai.models.generateContent({
      model: normalizedSettings.model,
      contents: { parts },
      config: {
        imageConfig,
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
    signal?.throwIfAborted();
    const image = response.candidates?.[0]?.content?.parts
      ?.find((part: any) => part.inlineData)?.inlineData;
    if (!image?.data || !image?.mimeType) {
      throw new Error('Модель не создала фон для защищённой композиции.');
    }
    const background = `data:${image.mimeType};base64,${image.data}`;
    const completedResult = onBackgroundComplete
      ? await onBackgroundComplete(background, index)
      : undefined;
    results.push({ background, completedResult });
  }
  return results;
}

async function generateExactArtFusedCover(
  sources: FusionSource[],
  reference: ImageSource | null,
  settings: GenerationSettings,
  referenceCompositionNotes: string | null,
  onProgress?: (p: CoverGenerationProgress) => void,
  signal?: AbortSignal,
  onResult?: CoverGenerationResultHandler,
): Promise<string[]> {
  if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 4) {
    throw new Error('Доступен пакет от 1 до 4 вариантов.');
  }
  validateExactArtProvider(settings, reference);
  const runSignal = signal ?? new AbortController().signal;
  runSignal.throwIfAborted();
  onProgress?.({ done: 0, total: settings.batchSize, phase: 'preparing' });

  const normalizedSources = await Promise.all(sources.map((source) => normalizeImageSource(source, runSignal)));
  const plannerSources: FusionSource[] = normalizedSources.map((source, index) => ({
    ...source,
    role: sources[index].role,
  }));
  for (const source of normalizedSources) {
    const dataUrl = `data:${source.mimeType};base64,${source.data}`;
    if (!preflightExactArtRaster(dataUrl)) {
      throw new Error('Для точной композиции поддерживаются только PNG, JPG и WEBP.');
    }
    await validateExactArtRaster(dataUrl, runSignal);
  }
  const normalizedReference = reference ? await normalizeImageSource(reference, runSignal) : null;
  if (normalizedReference) {
    const referenceDataUrl = `data:${normalizedReference.mimeType};base64,${normalizedReference.data}`;
    if (!preflightExactArtRaster(referenceDataUrl)) {
      throw new Error('Для точной композиции поддерживаются только PNG, JPG и WEBP.');
    }
    await validateExactArtRaster(referenceDataUrl, runSignal);
  }
  // Finish every deterministic provider/reference check before the first
  // billable BRIA mask request. Invalid GIF/SVG/oversized references must fail
  // locally without spending on subject extraction.
  const preparedReference = await prepareExactArtReference(settings, normalizedReference, runSignal);
  const maskInputs: ImageSource[] = [];
  for (const source of normalizedSources) {
    const [prepared] = await prepareImageReferences([source], runSignal);
    maskInputs.push(prepared);
  }
  const [compositionPlan, layers] = await Promise.all([
    planFusionComposition(plannerSources, settings, undefined, runSignal),
    prepareSubjectLayers(maskInputs, runSignal, { concurrency: 2 }),
  ]);

  runSignal.throwIfAborted();
  onProgress?.({ done: 0, total: settings.batchSize, phase: 'generating' });
  let finalizing = false;
  const beginFinalizing = () => {
    if (finalizing) return;
    finalizing = true;
    onProgress?.({ done: 0, total: settings.batchSize, phase: 'finalizing' });
  };
  const compose = async (background: string, index: number) => {
    beginFinalizing();
    const result = await compositeExactArtScene({
      background,
      sources: normalizedSources,
      layers,
      plan: compositionPlan,
      signal: runSignal,
    });
    await onResult?.(result);
    onProgress?.({ done: index + 1, total: settings.batchSize, phase: 'finalizing' });
    return result;
  };
  const backgrounds = await generateBackgroundPlates(
    settings,
    compositionPlan,
    preparedReference,
    referenceCompositionNotes,
    runSignal,
    compose,
  );

  runSignal.throwIfAborted();
  const results: string[] = [];
  for (const item of backgrounds) {
    // Every provider normally composes and publishes each completed background
    // before starting the next variant. The fallback protects adapter drift.
    results.push(item.completedResult ?? await compose(item.background, results.length));
  }
  return results;
}

export async function generateFusedCover(
  sources: FusionSource[],
  reference: ImageSource | null,
  settings: GenerationSettings,
  baseImage: ImageSource | null = null,
  likedImages: string[] = [],
  referenceCompositionNotes: string | null = null,
  onProgress?: (p: CoverGenerationProgress) => void,
  signal?: AbortSignal,
  onResult?: CoverGenerationResultHandler,
): Promise<string[]> {
  if (settings.preserveExactArt && !baseImage) {
    return generateExactArtFusedCover(
      sources,
      reference,
      settings,
      referenceCompositionNotes,
      onProgress,
      signal,
      onResult,
    );
  }
  if (settings.model === CHATGPT_IMAGE_MODEL) {
    return generateChatGPTFusedCover(sources, reference, settings, baseImage, likedImages, referenceCompositionNotes, onProgress, signal);
  }
  if (isOpenRouterImageModel(settings.model)) {
    return generateOpenRouterFusedCover(sources, reference, settings, baseImage, likedImages, referenceCompositionNotes, onProgress, signal, onResult);
  }
  settings = {
    ...settings,
    ...normalizeGeminiImageSettings(settings.model, settings.imageSize, settings.aspectRatio),
  } as GenerationSettings;
  const ai = await createGeminiClient();
  const model = settings.model;
  const normalizedBaseImage = baseImage ? await normalizeImageSource(baseImage, signal) : null;

  onProgress?.({
    done: 0,
    total: settings.batchSize,
    phase: 'preparing',
  });

  let compositionDescription = "";
  let compositionPlan: CompositionPlan | null = null;

  if (!baseImage) {
    const storedNotes = referenceCompositionNotes?.trim();
    const refTask =
      reference && storedNotes
        ? Promise.resolve().then(() => {
            compositionDescription = storedNotes;
          })
        : reference
          ? ai.models
              .generateContent({
                model: VISION_MODEL,
                contents: {
                  parts: [
                    {
                      text: "Analyze this image as a COMPOSITION TEMPLATE. For each main subject: 1) Position (left/right/center, depth). 2) Pose and scale vs frame. 3) Camera / perspective. DO NOT describe colors or character appearance — spatial layout only.",
                    },
                    {
                      inlineData: {
                        data: reference.data.split(",")[1] || reference.data,
                        mimeType: reference.mimeType,
                      },
                    },
                  ],
                },
              })
              .then((r) => {
                compositionDescription = r.text || "";
              })
              .catch((e) => {
                console.error("Failed to describe composition", e);
              })
          : Promise.resolve();

    const plannerTask = planFusionComposition(sources, settings, ai, signal).then((plan) => {
      compositionPlan = plan;
    });

    await Promise.all([refTask, plannerTask]);
  }

  const sceneLayout = !baseImage ? sceneLayoutBlock(sources) : "";

  // Pre-load liked images once before the batch loop to avoid redundant fetches
  // and to allow batch promises to run truly in parallel (no serial awaits inside loop).
  const likedInlineData: Array<{ data: string; mimeType: string }> = [];
  if (likedImages.length > 0) {
    // Gemini 2.5 is documented to work best with up to three input images.
    // Required source/base images always win; only optional quality examples are trimmed.
    const requiredGenerationImages = sources.length + Number(Boolean(normalizedBaseImage));
    const optionalReferenceLimit = optionalGeminiReferenceLimit(model, requiredGenerationImages, 3);
    const recentLikes = likedImages.slice(0, optionalReferenceLimit);
    for (const likedUrl of recentLikes) {
      try {
        const inline = await likedUrlToInlineData(likedUrl, signal);
        if (inline) likedInlineData.push(inline);
      } catch (e) {
        console.error("Failed to parse liked image", e);
      }
    }
  }

  let batchDone = 0;
  onProgress?.({
    done: 0,
    total: settings.batchSize,
    phase: 'generating',
  });
  const generatePromises: Promise<string[]>[] = [];

  // Since generateContent usually returns one image, we loop for batch size
  for (let i = 0; i < settings.batchSize; i++) {
    const parts: any[] = [];

    // Add source images with explicit labels
    sources.forEach((src, idx) => {
      parts.push({ text: fusionSourceLabel(src, idx) });
      parts.push({
        inlineData: {
          data: src.data.split(",")[1] || src.data,
          mimeType: src.mimeType,
        },
      });
    });

    // Add base image if refining
    if (normalizedBaseImage) {
      parts.push({ text: "BASE IMAGE TO REFINE (TEMPLATE):" });
      parts.push({
        inlineData: {
          data: normalizedBaseImage.data,
          mimeType: normalizedBaseImage.mimeType,
        },
      });
    }

    if (likedInlineData.length > 0) {
      parts.push({ text: "EXAMPLES OF HIGH-QUALITY RESULTS (Use these as a benchmark for quality, lighting, and integration):" });
      for (const inline of likedInlineData) {
        parts.push({ inlineData: { data: inline.data, mimeType: inline.mimeType } });
      }
    }

    // Add prompt with strict instructions
    const useCustomCreate = !baseImage && settings.customSystemPromptCreate?.trim();
    const useCustomEdit = baseImage && settings.customSystemPromptEdit?.trim();

    const fullPrompt = baseImage
      ? useCustomEdit
        ? settings.customSystemPromptEdit!
        : `TASK: SURGICAL REFINEMENT.
         OBJECTIVE: Modify "BASE IMAGE" using "SOURCE CHARACTER" as FIXED ASSETS.
         RULES:
         1. ZERO REDRAWING: Faces, hair, eyes, and features MUST be 100% identical to source.
         2. PIXEL-PERFECT: Use exact silhouettes. No new limbs or armor.
         3. STYLE: VIBRANT FANTASY DIGITAL PAINTING (Hearthstone style).
         4. INTEGRATION: Unified lighting, atmosphere, and contact shadows.
         5. LIGHTING: Single dominant light source. Strong rim lighting.
         6. COLOR: Match environment ambient light.
         7. GROUNDING: Realistic shadows connected to feet.
         8. PROMPT: ${settings.prompt ? `ONLY: ${settings.prompt}` : "Improve integration."}`
      : useCustomCreate
        ? `${settings.customSystemPromptCreate}
    ${compositionPlan ? `\n${formatCompositionPlan(compositionPlan)}` : ""}
    ${settings.strictMode ? `\nSTRICT MODE: If any conflict, prioritize exact match to SOURCE CHARACTER pixels over creativity.` : ""}
    ${sceneLayout ? sceneLayout : ""}
    ${compositionDescription ? `LAYOUT (reference template — spatial only):\n- ${compositionDescription}\n- Do NOT copy template scenery, palette, or character designs from the template.\n- Match scale and framing only.` : ""}`
        : `TASK: MASTER COMPOSITING — PHOTO-COMPOSITE, NOT RE-ILLUSTRATION.
    The selected image model must treat SOURCE images as UNTOUCHABLE identity references.
    RULES:
    1. ZERO REDRAW / ZERO "IMPROVING": Do not repaint faces, skin, hair, eyes, or costumes. No beautification, no style drift.
    2. COMPOSITE LIKE REAL PHOTO LAYERS: Only perspective warp, scale, blend edges, and relight onto ONE shared environment.
    3. FIDELITY: Every emblem, armor plate, horn, and strand must match the corresponding SOURCE.
    4. STYLE LOCK: Match the art style of the SOURCE card art (same brush feel); do not generic-paint new faces.
    5. ENVIRONMENT: One new coherent background; light wraps BOTH characters consistently (no split-screen lighting).
    6. NO COLLAGE: No visible seams, no duplicated horizons, no mismatched color grades left vs right.
    7. GROUNDING: Contact shadows; feet on shared ground plane.
    ${compositionPlan ? `
    ${formatCompositionPlan(compositionPlan)}
    ` : ""}
    ${settings.strictMode ? `
    STRICT MODE: If any conflict, prioritize exact match to SOURCE CHARACTER pixels over creativity.` : ""}
    ${sceneLayout ? sceneLayout : ""}
    ${compositionDescription ? `LAYOUT (reference template — spatial only):
    - ${compositionDescription}
    - Do NOT copy template scenery, palette, or character designs from the template.
    - Match scale and framing only.` : ""}`;

    const finalPrompt = `${fullPrompt}
    ${(settings.prompt && !baseImage) || (settings.prompt && useCustomEdit) ? `USER: ${settings.prompt}` : ""}
    ${settings.negativePrompt ? `AVOID: ${settings.negativePrompt}, redrawing, changing faces, mutation, extra limbs, collage, split-screen` : "AVOID: redrawing, changing faces, mutation, extra limbs, collage, split-screen"}`;

    const batchVariation =
      settings.batchSize > 1 && !baseImage
        ? `\nBATCH_VARIANT (${i + 1} of ${settings.batchSize}): Parallel variant. Change ONLY: camera distance, framing, or background environment layout. Do NOT change character faces, outfits, colors, or lighting on the characters themselves—keep them visually identical to SOURCE CHARACTER images.`
        : "";

    parts.push({ text: finalPrompt + batchVariation });

    const imageConfig: any = {
      aspectRatio: settings.aspectRatio,
    };
    
    if (MODELS_SUPPORTING_IMAGE_SIZE.has(model)) {
      imageConfig.imageSize = settings.imageSize;
    }

    const generatePromise = ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        imageConfig,
      },
    }).then(response => {
      const generatedUrls: string[] = [];
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          generatedUrls.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
      }
      batchDone++;
      onProgress?.({
        done: batchDone,
        total: settings.batchSize,
        phase: 'generating',
      });
      return generatedUrls;
    });

    generatePromises.push(generatePromise);
  }

  const resultsArrays = await Promise.all(generatePromises);
  let results = resultsArrays.flat();

  if (settings.strictMode && !baseImage && sources.length >= 2 && results.length > 0) {
    onProgress?.({
      done: settings.batchSize,
      total: settings.batchSize,
      phase: 'strict',
    });
    const runStrict = async (url: string): Promise<string> => {
      try {
        const { pass, issues } = await visionCheckFusionOutput(ai, sources, url, compositionPlan);
        if (pass) return url;
        const issueList = issues.length ? issues : ["Scene or identity coherence failed automated vision check"];
        const refined = await refineFusionAfterVision(ai, model, settings, sources, url, issueList, likedImages, compositionPlan);
        return refined || url;
      } catch (e) {
        console.error("strictMode vision QA", e);
        return url;
      }
    };
    const strictOut: string[] = [];
    for (let i = 0; i < results.length; i += STRICT_VISION_CONCURRENCY) {
      const chunk = results.slice(i, i + STRICT_VISION_CONCURRENCY);
      strictOut.push(...(await Promise.all(chunk.map(runStrict))));
    }
    results = strictOut;
  }

  return results;
}

/**
 * Normalize an ImageSource to base64 inlineData.
 * Handles both data URLs and http(s) public URLs from server storage.
 */
export async function normalizeImageSource(
  image: ImageSource,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
  throwIfImageHydrationAborted(signal);
  if (image.data.startsWith("/") || image.data.startsWith("http://") || image.data.startsWith("https://")) {
    const inline = await likedUrlToInlineData(image.data, signal);
    if (!inline) throw new Error(`Failed to fetch image from URL: ${image.data}`);
    throwIfImageHydrationAborted(signal);
    return inline;
  }
  return { data: image.data.split(",")[1] || image.data, mimeType: image.mimeType };
}

export async function upscaleImage(
  image: ImageSource,
  targetSize: "1K" | "2K" | "4K" = "4K",
  model: string = "gemini-3.1-flash-image"
): Promise<string> {
  const ai = await createGeminiClient();
  const normalized = await normalizeImageSource(image);
  const normalizedTargetSize = normalizeGeminiImageSettings(model, targetSize, "16:9").imageSize as "1K" | "2K" | "4K";

  const imageConfig: any = {};
  if (MODELS_SUPPORTING_IMAGE_SIZE.has(model)) {
    imageConfig.imageSize = normalizedTargetSize;
  }

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: normalized.data,
            mimeType: normalized.mimeType,
          },
        },
        { text: `UPSCALE TASK: Act as a high-end image restoration and super-resolution engine. 
                 Enhance this image to ${normalizedTargetSize} resolution.
                 Improve clarity, sharpen edges, remove compression artifacts, and enhance fine details (textures, hair, skin, materials). 
                 DO NOT change the content, composition, or colors. 
                 The output must be a pixel-perfect, high-resolution version of the input.` },
      ],
    },
    config: {
      imageConfig,
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to upscale image: No image data returned");
}

export async function expandImage(
  image: ImageSource,
  targetAspectRatio: "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9",
  prompt: string = "",
  model: string = "gemini-3.1-flash-image"
): Promise<string> {
  const ai = await createGeminiClient();
  const normalized = await normalizeImageSource(image);
  const normalizedAspectRatio = normalizeGeminiImageSettings(model, "1K", targetAspectRatio).aspectRatio as typeof targetAspectRatio;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: normalized.data,
            mimeType: normalized.mimeType,
          },
        },
        { text: `OUTPAINTING TASK: Expand this image to a ${normalizedAspectRatio} aspect ratio.
                 Maintain the original style, lighting, and content. 
                 Seamlessly extend the background and edges to fill the new frame. 
                 ${prompt ? `USER GUIDANCE: ${prompt}` : "Ensure the expansion is natural and consistent with the original scene."}` },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: normalizedAspectRatio,
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to expand image: No image data returned");
}
