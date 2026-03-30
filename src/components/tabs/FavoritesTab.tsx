import React from 'react';
import { motion } from 'motion/react';
import { Image as ImageIcon } from 'lucide-react';
import { ResultCard } from '../ResultCard';

interface FavoritesTabProps {
  likedImages: string[];
  likedSet: Set<string>;
  toggleLike: (url: string) => Promise<void>;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  onRefine: (url: string) => void;
}

export const FavoritesTab: React.FC<FavoritesTabProps> = ({
  likedImages,
  likedSet,
  toggleLike,
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
        <p className="text-zinc-500 mt-2">Работы, которые вам понравились</p>
      </div>

      {likedImages.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {likedImages.map((url, i) => (
            <ResultCard
              key={i}
              url={url}
              isLiked={true} 
              onToggleLike={toggleLike} 
              onUpscale={handleUpscale} 
              onFullscreen={setFullscreenImage} 
              onRefine={onRefine}
              onDownload={(url) => {
                const link = document.createElement('a');
                link.href = url;
                link.download = `favorite-${i}.png`;
                link.click();
              }}
            />
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
