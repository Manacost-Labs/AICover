import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Film, Image as ImageIcon, Layout, Loader2, Sparkles, X } from 'lucide-react';
import { ResultCard } from '../ResultCard';
import { VideoResultCard } from '../VideoResultCard';
import {
  PreviewScaleSlider,
  ScaledResultGrid,
  useResultPreviewScaleFromStorage,
} from '../ui/ResultPreviewScale';

interface FavoritesTabProps {
  likedImages: string[];
  likedSet: Set<string>;
  toggleLike: (url: string) => Promise<void>;
  /** Raw JSON or text from Gemini — why this pick vs batch siblings */
  favoriteChoiceNotes: Record<string, string>;
  favoriteAnalysisLoadingUrl: string | null;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  likedVideos: string[];
  likedVideoSet: Set<string>;
  toggleVideoLike: (url: string) => Promise<void>;
  videoFavoriteChoiceNotes: Record<string, string>;
  videoFavoriteAnalysisLoadingUrl: string | null;
  setFullscreenVideo: (url: string | null) => void;
  onRefine: (url: string) => void;
}

function formatFavoriteChoiceNote(raw: string): string {
  const cleaned = raw.replace(/```json\s*|```/gi, '').trim();
  try {
    const j = JSON.parse(cleaned) as {
      summary_ru?: string;
      likely_reasons_ru?: string[];
      vs_others_ru?: string;
    };
    if (j.summary_ru) {
      const lines: string[] = [j.summary_ru];
      if (Array.isArray(j.likely_reasons_ru) && j.likely_reasons_ru.length) {
        lines.push('');
        j.likely_reasons_ru.forEach((r) => lines.push(`• ${r}`));
      }
      if (j.vs_others_ru) {
        lines.push('');
        lines.push(j.vs_others_ru);
      }
      return lines.join('\n');
    }
  } catch {
    /* use raw */
  }
  return raw;
}

export const FavoritesTab: React.FC<FavoritesTabProps> = ({
  likedImages,
  likedSet,
  toggleLike,
  favoriteChoiceNotes,
  favoriteAnalysisLoadingUrl,
  handleUpscale,
  setFullscreenImage,
  likedVideos,
  likedVideoSet,
  toggleVideoLike,
  videoFavoriteChoiceNotes,
  videoFavoriteAnalysisLoadingUrl,
  setFullscreenVideo,
  onRefine
}) => {
  const [mediaKind, setMediaKind] = useState<'images' | 'videos'>('images');
  const { pct: previewScalePct, setPct: setPreviewScalePct, scale: previewScale } =
    useResultPreviewScaleFromStorage();
  const [choiceNoteModalUrl, setChoiceNoteModalUrl] = useState<string | null>(null);
  const [videoChoiceNoteModalUrl, setVideoChoiceNoteModalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!choiceNoteModalUrl && !videoChoiceNoteModalUrl) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setChoiceNoteModalUrl(null);
        setVideoChoiceNoteModalUrl(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [choiceNoteModalUrl, videoChoiceNoteModalUrl]);

  return (
    <>
    <div className="space-y-8">
      <div>
        <h2 className="text-4xl font-black tracking-tighter text-white">Избранное</h2>
        <p className="text-zinc-500 mt-2">
          Обложки и видео, которые вам понравились. Для свежих лайков ИИ сравнивает кадр с остальными вариантами батча на вкладке «Создать» или «Видео» и кратко объясняет вероятные причины выбора.
        </p>
        <div
          className="mt-5 inline-flex rounded-full bg-zinc-900/80 p-1 border border-white/10 shadow-inner"
          role="tablist"
          aria-label="Тип контента"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mediaKind === 'images'}
            onClick={() => setMediaKind('images')}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${
              mediaKind === 'images' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Layout className="w-4 h-4" />
            Изображения
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mediaKind === 'videos'}
            onClick={() => setMediaKind('videos')}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${
              mediaKind === 'videos' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Film className="w-4 h-4" />
            Видео
          </button>
        </div>
      </div>

      {(likedImages.length > 0 || likedVideos.length > 0) && (
        <PreviewScaleSlider value={previewScalePct} onChange={setPreviewScalePct} />
      )}

      {mediaKind === 'images' ? (
      <section className="space-y-6">
        <h3 className="text-xl font-black tracking-tight text-white">Обложки</h3>
        {likedImages.length > 0 ? (
          <ScaledResultGrid scale={previewScale}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {likedImages.map((url, i) => (
              <div key={url + i} className="space-y-3">
                <ResultCard
                  url={url}
                  isLiked={likedSet.has(url)}
                  onToggleLike={toggleLike}
                  onUpscale={handleUpscale}
                  onFullscreen={setFullscreenImage}
                  onRefine={onRefine}
                  onDownload={(dlUrl) => {
                    const link = document.createElement('a');
                    link.href = dlUrl;
                    link.download = `favorite-${i}.png`;
                    link.click();
                  }}
                />
                {favoriteAnalysisLoadingUrl === url && (
                  <div className="flex items-center gap-2 text-xs text-indigo-400 font-bold uppercase tracking-widest">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    Анализ выбора…
                  </div>
                )}
                {favoriteChoiceNotes[url] && favoriteAnalysisLoadingUrl !== url && (
                  <button
                    type="button"
                    onClick={() => setChoiceNoteModalUrl(url)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3 flex items-center gap-2 text-left hover:bg-zinc-800/50 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                      Почему этот кадр
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-zinc-500">Открыть</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          </ScaledResultGrid>
        ) : (
          <div className="h-[280px] flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/50 rounded-[3rem] border border-white/5">
            <div className="w-16 h-16 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5">
              <ImageIcon className="w-8 h-8 text-zinc-800" />
            </div>
            <h3 className="text-lg font-black tracking-tighter text-zinc-600">Нет избранных изображений</h3>
          </div>
        )}
      </section>
      ) : (
      <section className="space-y-6">
        <h3 className="text-xl font-black tracking-tight text-white">Клипы</h3>
        {likedVideos.length > 0 ? (
          <ScaledResultGrid scale={previewScale}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {likedVideos.map((url, i) => (
              <div key={url + i} className="space-y-3">
                <VideoResultCard
                  url={url}
                  isLiked={likedVideoSet.has(url)}
                  onToggleLike={toggleVideoLike}
                  onFullscreen={setFullscreenVideo}
                  onDownload={(dlUrl) => {
                    const link = document.createElement('a');
                    link.href = dlUrl;
                    link.download = `favorite-video-${i}.mp4`;
                    link.click();
                  }}
                />
                {videoFavoriteAnalysisLoadingUrl === url && (
                  <div className="flex items-center gap-2 text-xs text-violet-400 font-bold uppercase tracking-widest">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    Анализ выбора…
                  </div>
                )}
                {videoFavoriteChoiceNotes[url] && videoFavoriteAnalysisLoadingUrl !== url && (
                  <button
                    type="button"
                    onClick={() => setVideoChoiceNoteModalUrl(url)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3 flex items-center gap-2 text-left hover:bg-zinc-800/50 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0 text-violet-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">
                      Почему этот ролик
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-zinc-500">Открыть</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          </ScaledResultGrid>
        ) : (
          <div className="h-[280px] flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/50 rounded-[3rem] border border-white/5">
            <div className="w-16 h-16 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5">
              <Film className="w-8 h-8 text-zinc-800" />
            </div>
            <h3 className="text-lg font-black tracking-tighter text-zinc-600">Нет избранного видео</h3>
          </div>
        )}
      </section>
      )}
    </div>

    {createPortal(
      <AnimatePresence>
        {choiceNoteModalUrl && favoriteChoiceNotes[choiceNoteModalUrl] && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="favorite-choice-note-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-zinc-950/90 backdrop-blur-md"
            onClick={() => setChoiceNoteModalUrl(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col bg-zinc-900 border border-white/10 rounded-[2rem] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 p-6 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 shrink-0 text-indigo-400" />
                  <h3 id="favorite-choice-note-title" className="text-sm font-black uppercase tracking-widest text-indigo-400 truncate">
                    Почему этот кадр
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setChoiceNoteModalUrl(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 shrink-0"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 min-h-0">
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap font-medium">
                  {formatFavoriteChoiceNote(favoriteChoiceNotes[choiceNoteModalUrl])}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}

    {createPortal(
      <AnimatePresence>
        {videoChoiceNoteModalUrl && videoFavoriteChoiceNotes[videoChoiceNoteModalUrl] && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-favorite-choice-note-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-zinc-950/90 backdrop-blur-md"
            onClick={() => setVideoChoiceNoteModalUrl(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col bg-zinc-900 border border-white/10 rounded-[2rem] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 p-6 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 shrink-0 text-violet-400" />
                  <h3 id="video-favorite-choice-note-title" className="text-sm font-black uppercase tracking-widest text-violet-400 truncate">
                    Почему этот ролик
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setVideoChoiceNoteModalUrl(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 shrink-0"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 min-h-0">
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap font-medium">
                  {formatFavoriteChoiceNote(videoFavoriteChoiceNotes[videoChoiceNoteModalUrl])}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}
    </>
  );
};
