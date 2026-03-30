import { GoogleGenAI } from "@google/genai";

/** Multimodal vision for composition / QA (not the image generator). */
const VISION_MODEL = "gemini-3.1-flash-lite-preview";

export interface GenerationSettings {
  model: string;
  aspectRatio: "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9";
  imageSize: "512px" | "1K" | "2K" | "4K";
  prompt: string;
  negativePrompt?: string;
  batchSize: number;
  strictMode?: boolean;
}

export interface ImageSource {
  data: string; // base64
  mimeType: string;
}

/** Optional horizontal placement for scene-mode fusion (Create tab). */
export type SceneRole = "left" | "center" | "right";

export type FusionSource = ImageSource & { role?: SceneRole };

export function sceneRolesOrder(plan: 2 | 3): SceneRole[] {
  return plan === 2 ? ["left", "right"] : ["left", "center", "right"];
}

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
  return { data: dataUrl, mimeType: match[1] };
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }
  const ai = new GoogleGenAI({ apiKey });
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

/** Vision: lock-list per source — colors, light, must-preserve details (English, compact). */
async function analyzeSourceCharactersForFusion(
  ai: GoogleGenAI,
  sources: FusionSource[]
): Promise<string> {
  if (sources.length === 0) return "";
  const parts: any[] = [
    {
      text: `You help a compositing pipeline. For each SOURCE image in order, write 3–6 SHORT lines in English:
- Dominant colors / materials (for color matching)
- Light direction (where highlights fall)
- Silhouette and costume details that must NOT be redrawn or "improved"

Separate characters with a line "---". Max ~500 characters total.`,
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
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: { parts },
    });
    return (res.text || "").trim();
  } catch (e) {
    console.error("analyzeSourceCharactersForFusion", e);
    return "";
  }
}

/** Vision QA: compare OUTPUT to sources; request JSON. */
async function visionCheckFusionOutput(
  ai: GoogleGenAI,
  sources: FusionSource[],
  outputDataUrl: string
): Promise<{ pass: boolean; issues: string[] }> {
  let output: ImageSource;
  try {
    output = dataUrlToImageSource(outputDataUrl);
  } catch {
    return { pass: true, issues: [] };
  }
  const parts: any[] = [
    {
      text: `You are a strict QC reviewer for character compositing.

You see SOURCE character images (in order) and one OUTPUT image that should combine them into ONE scene.

Evaluate:
1) IDENTITY: Do each character's face, skin, hair, and costume match the corresponding SOURCE (no different face, no redesigned outfit)?
2) SCENE: Single coherent environment (not a collage / split lighting)?
3) LIGHTING: Acceptable unified light on characters (minor grading OK; broken or contradictory light = fail)?

Return ONLY valid JSON, no markdown:
{"pass":true|false,"issues":["bullet in English",...]}

Set pass to false if any character is clearly redrawn or unrecognizable vs its SOURCE, or the image is an obvious collage.`,
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
  likedImages: string[]
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
    for (const likedUrl of likedImages.slice(0, 2)) {
      const match = likedUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: { data: match[2], mimeType: match[1] },
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
${settings.prompt ? `USER NOTE (secondary): ${settings.prompt}` : ""}
${settings.negativePrompt ? `AVOID: ${settings.negativePrompt}` : ""}`;

  parts.push({ text: fixPrompt });

  const imageConfig: any = { aspectRatio: settings.aspectRatio };
  if (model === "gemini-3.1-flash-image-preview" || model === "gemini-3-pro-image-preview") {
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

export async function generateFusedCover(
  sources: FusionSource[],
  reference: ImageSource | null,
  settings: GenerationSettings,
  baseImage: ImageSource | null = null,
  likedImages: string[] = [],
  referenceCompositionNotes: string | null = null
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = settings.model;

  let compositionDescription = "";
  let sourceBrief = "";

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

    const briefTask = analyzeSourceCharactersForFusion(ai, sources).then((b) => {
      sourceBrief = b;
    });

    await Promise.all([refTask, briefTask]);
  }

  const sceneLayout = !baseImage ? sceneLayoutBlock(sources) : "";
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
    if (baseImage) {
      parts.push({ text: "BASE IMAGE TO REFINE (TEMPLATE):" });
      parts.push({
        inlineData: {
          data: baseImage.data.split(",")[1] || baseImage.data,
          mimeType: baseImage.mimeType,
        },
      });
    }

    if (likedImages.length > 0) {
      parts.push({ text: "EXAMPLES OF HIGH-QUALITY RESULTS (Use these as a benchmark for quality, lighting, and integration):" });
      // Only use up to 3 liked images to avoid overwhelming the prompt
      const recentLikes = likedImages.slice(0, 3);
      for (const likedUrl of recentLikes) {
        try {
          // Extract base64 and mime type from data URL
          const match = likedUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                data: match[2],
                mimeType: match[1],
              },
            });
          }
        } catch (e) {
          console.error("Failed to parse liked image", e);
        }
      }
    }

    // Add prompt with strict instructions
    const fullPrompt = baseImage 
      ? `TASK: SURGICAL REFINEMENT.
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
      : `TASK: MASTER COMPOSITING — PHOTO-COMPOSITE, NOT RE-ILLUSTRATION.
    The image model (Gemini 3.1 Flash Image) must treat SOURCE images as UNTOUCHABLE identity references.
    RULES:
    1. ZERO REDRAW / ZERO "IMPROVING": Do not repaint faces, skin, hair, eyes, or costumes. No beautification, no style drift.
    2. COMPOSITE LIKE REAL PHOTO LAYERS: Only perspective warp, scale, blend edges, and relight onto ONE shared environment.
    3. FIDELITY: Every emblem, armor plate, horn, and strand must match the corresponding SOURCE.
    4. STYLE LOCK: Match the art style of the SOURCE card art (same brush feel); do not generic-paint new faces.
    5. ENVIRONMENT: One new coherent background; light wraps BOTH characters consistently (no split-screen lighting).
    6. NO COLLAGE: No visible seams, no duplicated horizons, no mismatched color grades left vs right.
    7. GROUNDING: Contact shadows; feet on shared ground plane.
    ${sourceBrief ? `
    SOURCE_LOCK (VISION ANALYSIS — DO NOT VIOLATE):
    ${sourceBrief}
    ` : ""}
    ${settings.strictMode ? `
    STRICT MODE: If any conflict, prioritize exact match to SOURCE CHARACTER pixels over creativity.` : ""}
    ${sceneLayout ? sceneLayout : ""}
    ${compositionDescription ? `LAYOUT (reference template — spatial only):
    - ${compositionDescription}
    - Do NOT copy template scenery, palette, or character designs from the template.
    - Match scale and framing only.` : ""}`;

    const finalPrompt = `${fullPrompt}
    ${settings.prompt && !baseImage ? `USER: ${settings.prompt}` : ""}
    ${settings.negativePrompt ? `AVOID: ${settings.negativePrompt}, redrawing, changing faces, mutation, extra limbs, collage, split-screen` : "AVOID: redrawing, changing faces, mutation, extra limbs, collage, split-screen"}`;

    const batchVariation =
      settings.batchSize > 1 && !baseImage
        ? `\nBATCH_VARIANT (${i + 1} of ${settings.batchSize}): Parallel variant. Change ONLY: camera distance, framing, or background environment layout. Do NOT change character faces, outfits, colors, or lighting on the characters themselves—keep them visually identical to SOURCE CHARACTER images.`
        : "";

    parts.push({ text: finalPrompt + batchVariation });

    const imageConfig: any = {
      aspectRatio: settings.aspectRatio,
    };
    
    if (model === "gemini-3.1-flash-image-preview" || model === "gemini-3-pro-image-preview") {
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
      return generatedUrls;
    });

    generatePromises.push(generatePromise);
  }

  const resultsArrays = await Promise.all(generatePromises);
  let results = resultsArrays.flat();

  if (settings.strictMode && !baseImage && sources.length >= 2 && results.length > 0) {
    results = await Promise.all(
      results.map(async (url) => {
        try {
          const { pass, issues } = await visionCheckFusionOutput(ai, sources, url);
          if (pass) return url;
          const issueList = issues.length ? issues : ["Scene or identity coherence failed automated vision check"];
          const refined = await refineFusionAfterVision(ai, model, settings, sources, url, issueList, likedImages);
          return refined || url;
        } catch (e) {
          console.error("strictMode vision QA", e);
          return url;
        }
      })
    );
  }

  return results;
}

export async function upscaleImage(
  image: ImageSource,
  targetSize: "1K" | "2K" | "4K" = "4K",
  model: string = "gemini-3.1-flash-image-preview"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const imageConfig: any = {};
  if (model === "gemini-3.1-flash-image-preview" || model === "gemini-3-pro-image-preview") {
    imageConfig.imageSize = targetSize;
  }

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: image.data.split(",")[1] || image.data,
            mimeType: image.mimeType,
          },
        },
        { text: `UPSCALE TASK: Act as a high-end image restoration and super-resolution engine. 
                 Enhance this image to ${targetSize} resolution. 
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
  model: string = "gemini-3.1-flash-image-preview"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: image.data.split(",")[1] || image.data,
            mimeType: image.mimeType,
          },
        },
        { text: `OUTPAINTING TASK: Expand this image to a ${targetAspectRatio} aspect ratio. 
                 Maintain the original style, lighting, and content. 
                 Seamlessly extend the background and edges to fill the new frame. 
                 ${prompt ? `USER GUIDANCE: ${prompt}` : "Ensure the expansion is natural and consistent with the original scene."}` },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: targetAspectRatio,
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
