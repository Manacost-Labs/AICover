import { GoogleGenAI } from "@google/genai";
import type { ImageSource } from "./geminiService";

export type VeoProgressPhase = "submitting" | "polling" | "finalizing";

export interface VeoGenerateOptions {
  model: string;
  /** Output aspect ratio, e.g. "16:9", "9:16" (Veo-supported values). */
  aspectRatio: string;
  /** e.g. "720p", "1080p" */
  resolution: string;
  durationSeconds?: number;
  extraPrompt?: string;
}

const POLL_MS = 8000;

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

/**
 * Image-to-video via Veo. Returns data URL (video/mp4) for display and storage.
 */
export async function generateVeoVideoFromImage(
  sourceImage: ImageSource,
  basePrompt: string,
  options: VeoGenerateOptions,
  onProgress?: (phase: VeoProgressPhase) => void,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });
  const imageBytes = sourceImage.data.includes(",") ? sourceImage.data.split(",")[1]! : sourceImage.data;
  const mimeType = sourceImage.mimeType || "image/png";
  const prompt = [basePrompt.trim(), options.extraPrompt?.trim()].filter(Boolean).join("\n\n");

  onProgress?.("submitting");
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

  while (!operation.done) {
    if (signal?.aborted) throw new Error("Отменено");
    onProgress?.("polling");
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

  onProgress?.("finalizing");
  const vid = operation.response?.generatedVideos?.[0]?.video;
  if (!vid) throw new Error("Пустой ответ: нет видео");

  if (vid.videoBytes) {
    const mt = vid.mimeType || "video/mp4";
    return `data:${mt};base64,${vid.videoBytes}`;
  }
  if (vid.uri) {
    return fetchVideoUriToDataUrl(vid.uri, apiKey);
  }
  throw new Error("Нет ни videoBytes, ни uri в ответе");
}
