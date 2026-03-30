import React from 'react';
import { motion } from 'motion/react';
import { 
  Maximize2, 
  Heart, 
  Download, 
  RefreshCw 
} from 'lucide-react';

interface ResultCardProps {
  url: string;
  isLiked: boolean;
  onToggleLike: (url: string) => void;
  onUpscale: (url: string) => void;
  onFullscreen: (url: string) => void;
  onRefine: (url: string) => void;
  onDownload: (url: string) => void;
}

export const ResultCard: React.FC<ResultCardProps> = React.memo(({ 
  url, 
  isLiked, 
  onToggleLike, 
  onUpscale, 
  onFullscreen, 
  onRefine, 
  onDownload 
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={() => onFullscreen(url)}
      className="relative group rounded-[2rem] overflow-hidden bg-zinc-900 border border-white/5 shadow-xl hover:shadow-indigo-500/10 transition-all cursor-pointer"
    >
      <img
        src={url}
        alt="Generated Result"
        className="w-full h-auto block group-hover:scale-105 transition-transform duration-700"
        referrerPolicy="no-referrer"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 p-6 flex flex-col justify-end gap-4 translate-y-4 group-hover:translate-y-0">
        <div className="pointer-events-auto flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleLike(url)}
              className={`p-3 rounded-2xl transition-all ${isLiked ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={() => onUpscale(url)}
              className="p-3 bg-white/10 text-white rounded-2xl hover:bg-white/20 transition-all"
              title="Апскейл до 4K"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRefine(url)}
              className="p-3 bg-indigo-500 text-white rounded-2xl hover:bg-indigo-400 transition-all shadow-lg shadow-indigo-500/20"
              title="Использовать как основу"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => onDownload(url)}
              className="p-3 bg-white text-zinc-950 rounded-2xl hover:bg-zinc-100 transition-all shadow-lg shadow-white/10"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
