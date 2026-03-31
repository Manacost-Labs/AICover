import { GoogleGenAI } from "@google/genai";
import type { ImageSource } from "./geminiService";

export type VeoProgressPhase = "submitting" | "polling" | "finalizing";

/** Progress 0–100 for UI (bar + percent). */
export interface VeoProgressUpdate {
  phase: VeoProgressPhase;
  percent: number;
}

export interface VeoGenerateOptions {
  model: string;
  /** Output aspect ratio, e.g. "16:9", "9:16" (Veo-supported values). */
  aspectRatio: string;
  /** e.g. "720p", "1080p" */
  resolution: string;
  durationSeconds?: number;
  extraPrompt?: string;
  /** Parallel operations (each requests one clip). Max 4. */
  batchSize?: number;
}

/** Polling interval (ms). Slightly faster feedback without hammering the API. */
const POLL_MS = 4000;

function parseOperationProgress(operation: unknown): number | undefined {
  const op = operation as { metadata?: Record<string, unknown> };
  const m = op?.metadata;
  if (!m || typeof m !== "object") return undefined;
  const raw =
    m.progress ??
    m.progressPercent ??
    (m as { fractionCompleted?: number }).fractionCompleted ??
    (m as { percentComplete?: number }).percentComplete;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 0 && raw <= 1) return Math.round(raw * 100);
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  return undefined;
}

async function fetchVideoUriToDataUrl(uri: string, apiKey: string): Promise<string> {
  let res = await fetch(uri, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) {
    const sep = uri.includes("?") ? "&" : "?";
    res = await fetch(`${uri}${sep}key=${encodeURIComponent(apiKey)}`);
  }
  if (!res.ok) throw new Error(`Не удалось скачать видео: HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

async function videoFromGeneratedEntry(
  vid: { videoBytes?: string; uri?: string; mimeType?: string } | undefined,
  apiKey: string
): Promise<string> {
  if (!vid) throw new Error("Пустой video в ответе");
  if (vid.videoBytes) {
    const mt = vid.mimeType || "video/mp4";
    return `data:${mt};base64,${vid.videoBytes}`;
  }
  if (vid.uri) {
    return fetchVideoUriToDataUrl(vid.uri, apiKey);
  }
  throw new Error("Нет ни videoBytes, ни uri в ответе");
}

/**
 * One image-to-video job. Returns one data URL.
 */
async function generateOneVeoVideo(
  ai: GoogleGenAI,
  apiKey: string,
  sourceImage: ImageSource,
  basePrompt: string,
  options: Omit<VeoGenerateOptions, "batchSize">,
  onProgress: (u: VeoProgressUpdate) => void,
  signal?: AbortSignal
): Promise<string> {
  const imageBytes = sourceImage.data.includes(",") ? sourceImage.data.split(",")[1]! : sourceImage.data;
  const mimeType = sourceImage.mimeType || "image/png";
  const prompt = [basePrompt.trim(), options.extraPrompt?.trim()].filter(Boolean).join("\n\n");

  onProgress({ phase: "submitting", percent: 4 });
  let operation = await ai.models.generateVideos({
    model: options.model,
    prompt,
    image: { imageBytes, mimeType },
    config: {
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      durationSeconds: options.durationSeconds ?? 8,
      numberOfVideos: 1,
    },
  });

  let pollIndex = 0;
  while (!operation.done) {
    if (signal?.aborted) throw new Error("Отменено");
    pollIndex += 1;
    const fromMeta = parseOperationProgress(operation);
    const fallback = Math.min(90, 6 + pollIndex * 12);
    const pct = fromMeta ?? fallback;
    onProgress({ phase: "polling", percent: Math.min(95, pct) });
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (signal?.aborted) throw new Error("Отменено");
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    const msg =
      typeof operation.error === "object" && operation.error !== null && "message" in operation.error
        ? String((operation.error as { message?: unknown }).message)
        : JSON.stringify(operation.error);
    throw new Error(msg || "Ошибка генерации видео");
  }

  onProgress({ phase: "finalizing", percent: 97 });
  const vid = operation.response?.generatedVideos?.[0]?.video;
  const url = await videoFromGeneratedEntry(vid, apiKey);
  onProgress({ phase: "finalizing", percent: 100 });
  return url;
}

/**
 * Image-to-video via Veo. Returns one data URL per parallel job (batchSize 1–4).
 * Jobs run in parallel (Promise.all) for lower wall-clock time when batch &gt; 1.
 */
export async function generateVeoVideoFromImage(
  sourceImage: ImageSource,
  basePrompt: string,
  options: VeoGenerateOptions,
  onProgress?: (u: VeoProgressUpdate) => void,
  signal?: AbortSignal
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const batchSize = Math.min(4, Math.max(1, options.batchSize ?? 1));
  const perRequest: Omit<VeoGenerateOptions, "batchSize"> = {
    model: options.model,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    durationSeconds: options.durationSeconds,
    extraPrompt: options.extraPrompt,
  };

  onProgress?.({ phase: "submitting", percent: 0 });

  const ai = new GoogleGenAI({ apiKey });

  if (batchSize === 1) {
    const url = await generateOneVeoVideo(
      ai,
      apiKey,
      sourceImage,
      basePrompt,
      perRequest,
      (u) => onProgress?.(u),
      signal
    );
    return [url];
  }

  const slotPct = new Array(batchSize).fill(0);
  const reportSlot = (slot: number, u: VeoProgressUpdate) => {
    slotPct[slot] = u.percent;
    const avg = Math.round(slotPct.reduce((a, b) => a + b, 0) / batchSize);
    const phase: VeoProgressPhase = avg >= 95 ? "finalizing" : u.phase;
    onProgress?.({ phase, percent: Math.min(100, avg) });
  };

  const tasks = Array.from({ length: batchSize }, (_, slot) =>
    generateOneVeoVideo(
      ai,
      apiKey,
      sourceImage,
      basePrompt,
      perRequest,
      (u) => reportSlot(slot, u),
      signal
    )
  );

  const urls = await Promise.all(tasks);
  onProgress?.({ phase: "finalizing", percent: 100 });
  return urls;
}
