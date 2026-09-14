export const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "1:4", "1:8", "4:1", "8:1"];
export const RESOLUTIONS = ["512px", "1K", "2K", "4K"];

export const GENERATION_MODELS = [
  { id: "gemini-2.5-flash-image",        name: "2.5 Flash",  desc: "Самая быстрая" },
  { id: "gemini-3.1-flash-image-preview", name: "3.1 Flash",  desc: "Быстрая, высокое качество" },
  { id: "gemini-3-pro-image-preview",     name: "3 Pro",      desc: "Максимальное качество" },
] as const;

export const UPSCALE_EXPAND_MODELS = [
  { id: "gemini-2.5-flash-image",        label: "Gemini 2.5 Flash",  desc: "Максимальная скорость" },
  { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash", desc: "Лучший баланс скорости и качества" },
  { id: "gemini-3-pro-image-preview",     label: "Gemini 3 Pro",     desc: "Максимальная детализация текстур" },
] as const;

export const MODELS_SUPPORTING_IMAGE_SIZE = new Set([
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
]);

export const MODELS_NO_512PX = new Set([
  "gemini-3-pro-image-preview",
]);
