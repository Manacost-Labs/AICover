import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import { Eraser, Film, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import type { ImageSource } from "../../services/geminiService";
import {
  VEO_MODELS,
  VEO_ASPECT_RATIOS,
  VEO_RESOLUTIONS,
  VEO_BATCH_SIZES,
  VEO_DEFAULT_PROMPT,
} from "../../constants";
import { OptimizedImage } from "../OptimizedImage";
import { VideoResultCard } from "../VideoResultCard";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import type { VeoProgressPhase } from "../../services/veoService";

export interface VeoSettingsState {
  model: string;
  aspectRatio: string;
  resolution: string;
  extraPrompt: string;
  batchSize: 1 | 2 | 3 | 4;
}

interface VideoTabProps {
  sourceImage: ImageSource | null;
  setSourceImage: (v: ImageSource | null) => void;
  veoSettings: VeoSettingsState;
  setVeoSettings: React.Dispatch<React.SetStateAction<VeoSettingsState>>;
  isGenerating: boolean;
  videoProgressPhase: VeoProgressPhase | null;
  /** 0–100, ширина полосы в колонке «Результат» */
  videoProgressPercent: number;
  onGenerate: () => void;
  onCancel: () => void;
  /** Сброс исходника, параметров Veo, доп. промпта и превью результата на вкладке. */
  onClearAllFields: () => void;
  videoResults: string[];
  likedVideoSet: Set<string>;
  toggleVideoLike: (url: string) => Promise<void>;
  setFullscreenVideo: (url: string | null) => void;
  error: string | null;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export const VideoTab: React.FC<VideoTabProps> = ({
  sourceImage,
  setSourceImage,
  veoSettings,
  setVeoSettings,
  isGenerating,
  videoProgressPhase,
  videoProgressPercent,
  onGenerate,
  onCancel,
  onClearAllFields,
  videoResults,
  likedVideoSet,
  toggleVideoLike,
  setFullscreenVideo,
  error,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyImageFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const data = await readFileAsDataURL(file);
    setSourceImage({ data, mimeType: file.type });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    await applyImageFile(f);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
      setIsDragging(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    await applyImageFile(file);
  };

  const canRun = !!sourceImage && !isGenerating;

  return (
    <div id="video-tab" className="cover-tab-page grid grid-cols-1 lg:grid-cols-12 gap-10">
      <div className="lg:col-span-4 space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-4xl font-black tracking-tighter text-white flex items-center gap-3">
              <Film className="w-10 h-10 text-indigo-400 shrink-0" />
              Видео
            </h2>
            <p className="text-zinc-500 mt-2">
              Анимация кадра через Veo (image-to-video). Базовый промпт задаёт мягкое движение и зацикливание — дополните при необходимости.
            </p>
          </div>
          <button
            id="veo-clear-all-fields"
            type="button"
            onClick={onClearAllFields}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-white/10 bg-zinc-900/80 text-zinc-400 hover:text-white hover:border-white/20 hover:bg-zinc-800 transition-colors"
          >
            <Eraser className="w-4 h-4" />
            Очистить поля
          </button>
        </div>

        <section id="veo-section-source-image" className="space-y-4 scroll-mt-24">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Исходное изображение</h3>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          {sourceImage ? (
            <div
              className={`relative rounded-[2rem] overflow-hidden border aspect-video bg-zinc-900 transition-colors ${
                isDragging ? "border-indigo-500 border-2 ring-2 ring-indigo-500/30" : "border-white/10"
              }`}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <OptimizedImage src={sourceImage.data} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              {isDragging && (
                <div className="cover-dark-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950/60 backdrop-blur-sm pointer-events-none">
                  <Upload className="w-10 h-10 text-indigo-400" />
                  <span className="text-sm font-bold text-white">Отпустите, чтобы заменить кадр</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setSourceImage(null)}
                className="absolute top-3 right-3 p-2 rounded-xl bg-red-500/90 text-white z-20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              className={`w-full aspect-video rounded-[2rem] border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors ${
                isDragging
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-200 ring-2 ring-indigo-500/30"
                  : "border-white/10 text-zinc-500 hover:border-indigo-500/40 hover:text-indigo-300"
              }`}
            >
              <Upload className="w-8 h-8" />
              <span className="text-sm font-bold">Перетащите картинку сюда</span>
              <span className="text-xs text-zinc-600">или нажмите для выбора файла</span>
            </button>
          )}
        </section>

        <section id="veo-section-prompt" className="cover-tab-panel space-y-6 bg-zinc-900/50 p-6 rounded-[2rem] border border-white/5 scroll-mt-24">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Промпт</h3>
          <CollapsibleSection
            title="Базовый промпт Veo"
            description="Текст по умолчанию к каждому запросу — разверните, чтобы прочитать или скопировать."
            defaultOpen={false}
          >
            <div className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap rounded-xl bg-black/20 p-4 border border-white/5 max-h-48 overflow-y-auto">
              {VEO_DEFAULT_PROMPT}
            </div>
          </CollapsibleSection>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Дополнение (необязательно)</label>
            <textarea
              value={veoSettings.extraPrompt}
              onChange={(e) => setVeoSettings((s) => ({ ...s, extraPrompt: e.target.value }))}
              placeholder="Например: усилить свечение магии слева…"
              rows={3}
              className="w-full rounded-xl bg-zinc-950 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-600"
            />
          </div>
        </section>

        <section id="veo-section-params" className="cover-tab-panel space-y-4 bg-zinc-900/50 p-6 rounded-[2rem] border border-white/5 scroll-mt-24">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Параметры Veo</h3>
          <div id="veo-section-model" className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Модель</span>
            <div className="flex flex-col gap-2">
              {VEO_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setVeoSettings((s) => ({ ...s, model: m.id }))}
                  className={`px-4 py-2.5 rounded-xl text-left text-xs font-bold border ${
                    veoSettings.model === m.id
                      ? "cover-choice-active"
                      : "cover-choice-idle"
                  }`}
                >
                  {m.name} — {m.desc}
                </button>
              ))}
            </div>
          </div>
          <div id="veo-section-format" className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Формат (соотношение сторон)</span>
            <div className="flex gap-2 flex-wrap">
              {VEO_ASPECT_RATIOS.map((ar) => (
                <button
                  key={ar}
                  type="button"
                  onClick={() => setVeoSettings((s) => ({ ...s, aspectRatio: ar }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    veoSettings.aspectRatio === ar ? "bg-indigo-600 text-white" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>
          </div>
          <div id="veo-section-resolution" className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Качество (разрешение)</span>
            <div className="flex gap-2 flex-wrap">
              {VEO_RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setVeoSettings((s) => ({ ...s, resolution: r.id }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    veoSettings.resolution === r.id ? "bg-indigo-600 text-white" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div id="veo-section-batch" className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Параллельно (кол-во роликов)</span>
            <p className="text-[11px] text-zinc-600 leading-snug">
              Несколько отдельных запросов к Veo одновременно — быстрее по времени ожидания, чем по очереди.
            </p>
            <div className="flex gap-2 flex-wrap">
              {VEO_BATCH_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setVeoSettings((s) => ({ ...s, batchSize: n }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    veoSettings.batchSize === n ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </section>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={!canRun}
            onClick={onGenerate}
            className="w-full py-4 rounded-2xl font-black uppercase tracking-tight text-sm flex items-center justify-center gap-2 bg-white text-zinc-950 disabled:opacity-40"
          >
            {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            Создать видео
          </button>
          {isGenerating && (
            <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:text-white w-full py-2">
              Отменить генерацию
            </button>
          )}
        </div>
      </div>

      <div id="veo-section-result" className="lg:col-span-8 space-y-6 scroll-mt-24">
        <h3 className="text-xl font-black text-white">Результат</h3>

        {isGenerating && (
          <div
            id="veo-generation-progress"
            className="rounded-[2rem] border border-violet-500/25 bg-zinc-900/80 p-8 shadow-[0_0_40px_rgba(139,92,246,0.12)]"
          >
            <div className="flex items-end justify-between gap-4 mb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">Генерация</p>
                <p className="text-sm text-zinc-400 mt-1">
                  {videoProgressPhase === "submitting" && "Отправка запроса…"}
                  {videoProgressPhase === "polling" && "Veo обрабатывает (параллельные задачи учитываются в среднем %)…"}
                  {videoProgressPhase === "finalizing" && "Сборка файла…"}
                  {!videoProgressPhase && "Подождите…"}
                </p>
              </div>
              <span className="text-3xl font-black tabular-nums text-white">{Math.round(videoProgressPercent)}%</span>
            </div>
            <div className="h-4 rounded-full bg-zinc-800 overflow-hidden border border-white/5">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500"
                initial={false}
                animate={{ width: `${Math.min(100, Math.max(0, videoProgressPercent))}%` }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              />
            </div>
          </div>
        )}

        {videoResults.length === 0 && !isGenerating ? (
          <div className="h-[400px] flex flex-col items-center justify-center rounded-[3rem] border border-white/5 bg-zinc-900/40">
            <ImageIcon className="w-16 h-16 text-zinc-700 mb-4" />
            <p className="text-zinc-500 text-center max-w-sm">Здесь появятся клипы после генерации.</p>
          </div>
        ) : videoResults.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {videoResults.map((url, i) => (
              <VideoResultCard
                key={url + i}
                url={url}
                isLiked={likedVideoSet.has(url)}
                onToggleLike={toggleVideoLike}
                onFullscreen={setFullscreenVideo}
                onDownload={(u) => {
                  const a = document.createElement("a");
                  a.href = u;
                  a.download = `veo-${i}.mp4`;
                  a.click();
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
