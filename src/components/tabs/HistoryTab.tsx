import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Film, Layout } from 'lucide-react';
import { ResultCard } from '../ResultCard';
import { VideoResultCard } from '../VideoResultCard';
import { clearVideoHistory } from '../../services/supabaseService';

interface HistoryTabProps {
  history: string[];
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
  likedSet: Set<string>;
  toggleLike: (url: string) => Promise<void>;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  videoHistory: string[];
  setVideoHistory: React.Dispatch<React.SetStateAction<string[]>>;
  likedVideoSet: Set<string>;
  toggleVideoLike: (url: string) => Promise<void>;
  setFullscreenVideo: (url: string | null) => void;
  onRefine: (url: string) => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  history,
  setHistory,
  likedSet,
  toggleLike,
  handleUpscale,
  setFullscreenImage,
  videoHistory,
  setVideoHistory,
  likedVideoSet,
  toggleVideoLike,
  setFullscreenVideo,
  onRefine
}) => {
  const [mediaKind, setMediaKind] = useState<'images' | 'videos'>('images');

  const clearImageHistory = () => {
    setHistory([]);
  };

  const clearVideoHistoryLocal = () => {
    setVideoHistory([]);
    void clearVideoHistory();
  };

  return (
    <motion.div 
      key="history"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div>
        <h2 className="text-4xl font-black tracking-tighter text-white">История</h2>
        <p className="text-zinc-500 mt-2">Последние генерации обложек и видео</p>
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

      {mediaKind === 'images' ? (
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-xl font-black tracking-tight text-white">Обложки</h3>
            <button 
              type="button"
              onClick={clearImageHistory}
              disabled={history.length === 0}
              className="px-6 py-2 bg-red-500/10 text-red-500 rounded-full text-sm font-bold hover:bg-red-500/20 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              Очистить историю
            </button>
          </div>

          {history.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {history.map((url, i) => (
                <ResultCard
                  key={url}
                  url={url}
                  isLiked={likedSet.has(url)} 
                  onToggleLike={toggleLike} 
                  onUpscale={handleUpscale} 
                  onFullscreen={setFullscreenImage} 
                  onRefine={onRefine}
                  onDownload={(dlUrl) => {
                    const link = document.createElement('a');
                    link.href = dlUrl;
                    link.download = `history-${i}.png`;
                    link.click();
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="h-[min(400px,60vh)] flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/50 rounded-[3rem] border border-white/5">
              <div className="w-16 h-16 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5">
                <Layout className="w-8 h-8 text-zinc-800" />
              </div>
              <h3 className="text-lg font-black tracking-tighter text-zinc-600">Нет обложек в истории</h3>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-xl font-black tracking-tight text-white">Клипы</h3>
            <button 
              type="button"
              onClick={clearVideoHistoryLocal}
              disabled={videoHistory.length === 0}
              className="px-6 py-2 bg-red-500/10 text-red-500 rounded-full text-sm font-bold hover:bg-red-500/20 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              Очистить видео
            </button>
          </div>

          {videoHistory.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {videoHistory.map((url, i) => (
                <VideoResultCard
                  key={url}
                  url={url}
                  isLiked={likedVideoSet.has(url)}
                  onToggleLike={toggleVideoLike}
                  onFullscreen={setFullscreenVideo}
                  onDownload={(dlUrl) => {
                    const link = document.createElement('a');
                    link.href = dlUrl;
                    link.download = `history-video-${i}.mp4`;
                    link.click();
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="h-[min(400px,60vh)] flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/50 rounded-[3rem] border border-white/5">
              <div className="w-16 h-16 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5">
                <Film className="w-8 h-8 text-zinc-800" />
              </div>
              <h3 className="text-lg font-black tracking-tighter text-zinc-600">Нет видео в истории</h3>
            </div>
          )}
        </section>
      )}
    </motion.div>
  );
};
