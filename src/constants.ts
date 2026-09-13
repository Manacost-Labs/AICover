export const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "1:4", "1:8", "4:1", "8:1"];
export const RESOLUTIONS = ["512px", "1K", "2K", "4K"];

export const GENERATION_MODELS = [
  { id: "gemini-2.5-flash-image",        name: "2.5 Flash",  desc: "Самая быстрая" },
  { id: "gemini-3.1-flash-image",         name: "3.1 Flash",  desc: "Быстрая, высокое качество" },
  { id: "gemini-3-pro-image",             name: "3 Pro",      desc: "Максимальное качество" },
] as const;

export const UPSCALE_EXPAND_MODELS = [
  { id: "gemini-2.5-flash-image",        label: "Gemini 2.5 Flash",  desc: "Максимальная скорость" },
  { id: "gemini-3.1-flash-image",         label: "Gemini 3.1 Flash", desc: "Лучший баланс скорости и качества" },
  { id: "gemini-3-pro-image",             label: "Gemini 3 Pro",     desc: "Максимальная детализация текстур" },
] as const;

export const MODELS_SUPPORTING_IMAGE_SIZE = new Set([
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
]);

export const MODELS_NO_512PX = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image",
]);

const GEMINI_STANDARD_ASPECT_RATIOS = [
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
] as const;

export const GEMINI_IMAGE_CAPABILITIES = {
  "gemini-2.5-flash-image": {
    resolutions: ["1K"],
    aspectRatios: GEMINI_STANDARD_ASPECT_RATIOS,
  },
  "gemini-3.1-flash-image": {
    resolutions: ["512px", "1K", "2K", "4K"],
    aspectRatios: ASPECT_RATIOS,
  },
  "gemini-3-pro-image": {
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: GEMINI_STANDARD_ASPECT_RATIOS,
  },
  "gemini-3.1-flash-lite-image": {
    resolutions: ["1K"],
    aspectRatios: GEMINI_STANDARD_ASPECT_RATIOS,
  },
} as const;

type GeminiImageModel = keyof typeof GEMINI_IMAGE_CAPABILITIES;

export function getGeminiImageCapabilities(model: string) {
  return GEMINI_IMAGE_CAPABILITIES[model as GeminiImageModel] ?? null;
}

export function supportsGeminiImageSize(model: string, imageSize: string): boolean {
  const capabilities = getGeminiImageCapabilities(model);
  return !capabilities || (capabilities.resolutions as readonly string[]).includes(imageSize);
}

export function supportsGeminiAspectRatio(model: string, aspectRatio: string): boolean {
  const capabilities = getGeminiImageCapabilities(model);
  return !capabilities || (capabilities.aspectRatios as readonly string[]).includes(aspectRatio);
}

/** Keep persisted/request settings inside the documented contract for the selected Gemini model. */
export function normalizeGeminiImageSettings(model: string, imageSize: string, aspectRatio: string) {
  const capabilities = getGeminiImageCapabilities(model);
  if (!capabilities) return { imageSize, aspectRatio };
  return {
    imageSize: supportsGeminiImageSize(model, imageSize) ? imageSize : "1K",
    aspectRatio: supportsGeminiAspectRatio(model, aspectRatio) ? aspectRatio : "16:9",
  };
}

export const VEO_MODELS = [
  { id: "veo-3.1-generate-preview", name: "Veo 3.1", desc: "Высокое качество" },
  { id: "veo-3.1-fast-generate-preview", name: "Veo 3.1 Fast", desc: "Быстрее" },
] as const;

export const VEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

export const VEO_RESOLUTIONS = [
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
] as const;

/** Параллельных запросов Veo (каждый — отдельное видео). */
export const VEO_BATCH_SIZES = [1, 2, 3, 4] as const;

export const VEO_DEFAULT_PROMPT = `A detailed fantasy illustration comes to life with minimal motion. Magical particles float slowly upward, fire flickers softly, water surface shimmers with subtle ripples. The composition stays locked — no zoom, no pan. Seamless loop, painterly style preserved.`;
