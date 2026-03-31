import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import { Film, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import type { ImageSource } from "../../services/geminiService";
import {
  VEO_MODELS,
  VEO_ASPECT_RATIOS,
  VEO_RESOLUTIONS,
  VEO_COMPRESSION_OPTIONS,
  VEO_DEFAULT_PROMPT,
  type VeoCompressionPreset,
} from "../../constants";
import { OptimizedImage } from "../OptimizedImage";
import { VideoResultCard } from "../VideoResultCard";
import type { VeoProgressPhase } from "../../services/veoService";

export interface VeoSettingsState {
  model: string;
  aspectRatio: string;
  resolution: string;
  compression: VeoCompressionPreset;
  extraPrompt: string;
}

interface VideoTabProps {
  sourceImage: ImageSource | null;
  setSourceImage: (v: ImageSource | null) => void;
  veoSettings: VeoSettingsState;
  setVeoSettings: React.Dispatch<React.SetStateAction<VeoSettingsState>>;
  isGenerating: boolean;
  videoProgressPhase: VeoProgressPhase | null;
  onGenerate: () => void;
  onCancel: () => void;
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
  onGenerate,
  onCancel,
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
    <motion.div
      key="video"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="grid grid-cols-1 lg:grid-cols-12 gap-10"
    >
      <div className="lg:col-span-4 space-y-8">
        <div>
          <h2 className="text-4xl font-black tracking-tighter text-white flex items-center gap-3">
            <Film className="w-10 h-10 text-indigo-400" />
            Видео
          </h2>
          <p className="text-zinc-500 mt-2">
            Анимация кадра через Veo (image-to-video). Базовый промпт задаёт мягкое движение и зацикливание — дополните при необходимости.
          </p>
        </div>

        <section className="space-y-4">
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
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950/60 backdrop-blur-sm pointer-events-none">
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

        <section className="space-y-6 bg-zinc-900/50 p-6 rounded-[2rem] border border-white/5">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Промпт</h3>
          <div className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap rounded-xl bg-black/20 p-4 border border-white/5 max-h-32 overflow-y-auto">
            {VEO_DEFAULT_PROMPT}
          </div>
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

        <section className="space-y-4 bg-zinc-900/50 p-6 rounded-[2rem] border border-white/5">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Параметры Veo</h3>
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Модель</span>
            <div className="flex flex-col gap-2">
              {VEO_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setVeoSettings((s) => ({ ...s, model: m.id }))}
                  className={`px-4 py-2.5 rounded-xl text-left text-xs font-bold border ${
                    veoSettings.model === m.id
                      ? "bg-white text-zinc-950 border-white"
                      : "bg-white/5 border-white/10 text-zinc-400"
                  }`}
                >
                  {m.name} — {m.desc}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Формат</span>
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
          <div className="space-y-2">
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
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Сжатие</span>
            <div className="flex flex-col gap-2">
              {VEO_COMPRESSION_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setVeoSettings((s) => ({ ...s, compression: o.id }))}
                  className={`px-4 py-2 rounded-xl text-xs font-bold text-left ${
                    veoSettings.compression === o.id ? "bg-white text-zinc-950" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {o.label}
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
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 text-center">
                {videoProgressPhase === "submitting" && "Отправка…"}
                {videoProgressPhase === "polling" && "Генерация Veo (долго)…"}
                {videoProgressPhase === "finalizing" && "Финализация…"}
                {!videoProgressPhase && "Подождите…"}
              </p>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-indigo-500"
                  animate={{ width: videoProgressPhase === "polling" ? ["30%", "70%", "40%"] : "100%" }}
                  transition={{ duration: videoProgressPhase === "polling" ? 2 : 0.3, repeat: videoProgressPhase === "polling" ? Infinity : 0 }}
                />
              </div>
              <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:text-white w-full py-2">
                Отмена
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-8 space-y-6">
        <h3 className="text-xl font-black text-white">Результат</h3>
        {videoResults.length === 0 && !isGenerating ? (
          <div className="h-[400px] flex flex-col items-center justify-center rounded-[3rem] border border-white/5 bg-zinc-900/40">
            <ImageIcon className="w-16 h-16 text-zinc-700 mb-4" />
            <p className="text-zinc-500 text-center max-w-sm">Здесь появится клип после генерации.</p>
          </div>
        ) : (
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
        )}
      </div>
    </motion.div>
  );
};
