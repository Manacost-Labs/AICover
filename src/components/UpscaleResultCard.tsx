import React from 'react';
import { motion } from 'motion/react';
import { OptimizedImage } from './OptimizedImage';
import { 
  Maximize2, 
  Download, 
  RefreshCw, 
  Loader2, 
  Check, 
  AlertTriangle 
} from 'lucide-react';

interface UpscaleResultCardProps {
  item: any;
  onRetry: (url: string, id: string) => void;
  onFullscreen: (url: string) => void;
  onRefine?: (url: string) => void;
}

export const UpscaleResultCard: React.FC<UpscaleResultCardProps> = React.memo(({ 
  item, 
  onRetry, 
  onFullscreen,
  onRefine
}) => {
  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-zinc-900/50 border border-white/5 rounded-[2.5rem] overflow-hidden group shadow-sm hover:shadow-md transition-all"
    >
      <div className="relative bg-zinc-950">
        {item.status === 'loading' ? (
          <div className="aspect-video flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Обработка ({item.resolution})...</p>
          </div>
        ) : item.status === 'error' ? (
          <div className="aspect-video flex flex-col items-center justify-center gap-4 p-6 text-center">
            <AlertTriangle className="w-10 h-10 text-red-500" />
            <p className="text-xs text-red-400 font-medium">{item.error}</p>
            <button
              onClick={() => onRetry(item.originalUrl, item.id)}
              className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Попробовать снова
            </button>
          </div>
        ) : (
          <>
            <OptimizedImage
              src={item.upscaledUrl}
              className="w-full h-auto block cursor-pointer"
              onClick={() => onFullscreen(item.upscaledUrl!)}
              referrerPolicy="no-referrer"
              priority
            />
            <div className="absolute top-4 right-4 px-3 py-1.5 bg-green-500 text-white rounded-full text-[10px] font-black flex items-center gap-2 shadow-lg shadow-green-500/20">
              <Check className="w-3 h-3" />
              {item.resolution}
            </div>
          </>
        )}
      </div>
      <div className="p-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden border border-white/5">
            <OptimizedImage src={item.originalUrl} className="w-full h-full object-cover opacity-50" referrerPolicy="no-referrer" />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Оригинал</div>
            <div className="text-[10px] font-bold text-zinc-400">Source Image</div>
          </div>
        </div>
        {item.status === 'done' && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                const link = document.createElement('a');
                link.href = item.upscaledUrl!;
                link.download = `upscaled-${item.resolution}.png`;
                link.click();
              }}
              className="p-3 bg-white text-zinc-950 rounded-2xl hover:bg-zinc-100 transition-all shadow-lg shadow-white/10"
            >
              <Download className="w-5 h-5" />
            </button>
            <button 
              onClick={() => onFullscreen(item.upscaledUrl!)}
              className="p-3 bg-white/10 text-white rounded-2xl hover:bg-white/20 transition-all"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
            {onRefine && (
              <button 
                onClick={() => onRefine(item.upscaledUrl!)}
                className="p-3 bg-indigo-500 text-white rounded-2xl hover:bg-indigo-400 transition-all shadow-lg shadow-indigo-500/20"
                title="Использовать как основу"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
});
