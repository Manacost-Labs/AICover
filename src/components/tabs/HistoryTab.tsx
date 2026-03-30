import React from 'react';
import { motion } from 'motion/react';
import { Layout } from 'lucide-react';
import { ResultCard } from '../ResultCard';
import { set } from 'idb-keyval';

interface HistoryTabProps {
  history: string[];
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
  likedSet: Set<string>;
  toggleLike: (url: string) => Promise<void>;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  onRefine: (url: string) => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  history,
  setHistory,
  likedSet,
  toggleLike,
  handleUpscale,
  setFullscreenImage,
  onRefine
}) => {
  return (
    <motion.div 
      key="history"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-10"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black tracking-tighter text-white">История</h2>
          <p className="text-zinc-500 mt-2">Ваши последние генерации</p>
        </div>
        <button 
          onClick={async () => {
            setHistory([]);
            await set('fusion_history', []);
          }}
          className="px-6 py-2 bg-red-500/10 text-red-500 rounded-full text-sm font-bold hover:bg-red-500/20 transition-all"
        >
          Очистить историю
        </button>
      </div>

      {history.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {history.map((url, i) => (
            <ResultCard
              key={i}
              url={url}
              isLiked={likedSet.has(url)} 
              onToggleLike={toggleLike} 
              onUpscale={handleUpscale} 
              onFullscreen={setFullscreenImage} 
              onRefine={onRefine}
              onDownload={(url) => {
                const link = document.createElement('a');
                link.href = url;
                link.download = `history-${i}.png`;
                link.click();
              }}
            />
          ))}
        </div>
      ) : (
        <div className="h-[400px] flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/50 rounded-[3rem] border border-white/5">
          <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5">
            <Layout className="w-10 h-10 text-zinc-800" />
          </div>
          <h3 className="text-2xl font-black tracking-tighter text-zinc-600">История пуста</h3>
          <p className="text-zinc-500 max-w-xs">Здесь появятся ваши первые работы после генерации.</p>
        </div>
      )}
    </motion.div>
  );
};
