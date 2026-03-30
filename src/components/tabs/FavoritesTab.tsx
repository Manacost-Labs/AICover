import React from 'react';
import { motion } from 'motion/react';
import { Image as ImageIcon, Loader2, Sparkles } from 'lucide-react';
import { ResultCard } from '../ResultCard';

interface FavoritesTabProps {
  likedImages: string[];
  likedSet: Set<string>;
  toggleLike: (url: string) => Promise<void>;
  /** Raw JSON or text from Gemini — why this pick vs batch siblings */
  favoriteChoiceNotes: Record<string, string>;
  favoriteAnalysisLoadingUrl: string | null;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
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
  onRefine
}) => {
  return (
    <motion.div 
      key="favorites"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-10"
    >
      <div>
        <h2 className="text-4xl font-black tracking-tighter text-white">Избранное</h2>
        <p className="text-zinc-500 mt-2">
          Работы, которые вам понравились. Для свежих лайков ИИ сравнивает кадр с остальными вариантами батча на вкладке «Создать» и кратко объясняет вероятные причины выбора.
        </p>
      </div>

      {likedImages.length > 0 ? (
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
                <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    Почему этот кадр
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap font-medium">
                    {formatFavoriteChoiceNote(favoriteChoiceNotes[url])}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="h-[400px] flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/50 rounded-[3rem] border border-white/5">
          <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5">
            <ImageIcon className="w-10 h-10 text-zinc-800" />
          </div>
          <h3 className="text-2xl font-black tracking-tighter text-zinc-600">Ничего не выбрано</h3>
          <p className="text-zinc-500 max-w-xs">Нажимайте «Оценить» на понравившихся работах, чтобы они появились здесь.</p>
        </div>
      )}
    </motion.div>
  );
};
