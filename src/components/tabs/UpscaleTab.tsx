import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Settings, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Maximize2, 
  Loader2, 
  AlertTriangle 
} from 'lucide-react';
import { UpscaleResultCard } from '../UpscaleResultCard';
import { OptimizedImage } from '../OptimizedImage';
import { UPSCALE_EXPAND_MODELS } from '../../constants';

interface UpscaleTabProps {
  upscaleSource: { data: string; mimeType: string } | null;
  setUpscaleSource: (source: { data: string; mimeType: string } | null) => void;
  upscaleSettings: { model: string; imageSize: "1K" | "2K" | "4K" };
  setUpscaleSettings: React.Dispatch<React.SetStateAction<{ model: string; imageSize: "1K" | "2K" | "4K" }>>;
  isUpscaling: boolean;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  upscaleResults: any[];
  setUpscaleResults: React.Dispatch<React.SetStateAction<any[]>>;
  setFullscreenImage: (url: string | null) => void;
  onRefine: (url: string) => void;
  error: string | null;
}

export const UpscaleTab: React.FC<UpscaleTabProps> = ({
  upscaleSource,
  setUpscaleSource,
  upscaleSettings,
  setUpscaleSettings,
  isUpscaling,
  handleUpscale,
  upscaleResults,
  setUpscaleResults,
  setFullscreenImage,
  onRefine,
  error
}) => {
  const [showUpscaleSettings, setShowUpscaleSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setUpscaleSource({ data: reader.result as string, mimeType: file.type });
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="cover-tool-page max-w-4xl mx-auto space-y-12">
      <section className="space-y-6 text-center">
        <h2 className="cover-tool-title text-3xl font-black tracking-tighter">
          Улучшение качества (4K)
        </h2>
        <p className="text-zinc-400">
          Загрузите изображение, чтобы увеличить его разрешение и детализацию с помощью ИИ.
        </p>
      </section>

      <section className="cover-tab-panel bg-zinc-900/50 border border-white/5 rounded-[2.5rem] p-8 space-y-8">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-300 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Настройки апскейла
          </h3>
          <button 
            onClick={() => setShowUpscaleSettings(!showUpscaleSettings)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500"
          >
            {showUpscaleSettings ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>

        <AnimatePresence>
          {showUpscaleSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-8"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                <div className="space-y-4">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Модель апскейла</label>
                  <div className="flex flex-col gap-2">
                    {UPSCALE_EXPAND_MODELS.map(m => (
                      <button 
                        key={m.id}
                        onClick={() => setUpscaleSettings(s => ({ ...s, model: m.id }))}
                        className={`p-4 rounded-2xl text-left transition-all border ${upscaleSettings.model === m.id ? 'cover-choice-active shadow-lg' : 'cover-choice-idle'}`}
                      >
                        <div className="font-bold text-xs">{m.label}</div>
                        <div className={`text-[10px] mt-1 ${upscaleSettings.model === m.id ? 'text-zinc-500' : 'text-zinc-600'}`}>{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Целевое качество</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { id: "1K", label: "1K Resolution", desc: "1024 x 1024 (Быстро)" },
                      { id: "2K", label: "2K Resolution", desc: "2048 x 2048 (Четко)" },
                      { id: "4K", label: "4K Resolution", desc: "4096 x 4096 (Ультра)" }
                    ].map(res => (
                      <button 
                        key={res.id}
                        onClick={() => setUpscaleSettings(s => ({ ...s, imageSize: res.id as any }))}
                        className={`p-4 rounded-2xl text-left transition-all border ${upscaleSettings.imageSize === res.id ? 'cover-choice-active shadow-lg' : 'cover-choice-idle'}`}
                      >
                        <div className="font-bold text-xs">{res.label}</div>
                        <div className={`text-[10px] mt-1 ${upscaleSettings.imageSize === res.id ? 'text-zinc-500' : 'text-zinc-600'}`}>{res.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) handleFile(file);
              }
            }
          }}
          tabIndex={0}
          className={`cover-upload-workbench relative aspect-video rounded-[3rem] border-2 border-dashed transition-all flex flex-col items-center justify-center gap-6 overflow-hidden bg-zinc-900/50 outline-none focus:ring-2 focus:ring-indigo-500/50 ${isDragging ? 'border-indigo-500 bg-indigo-500/5 scale-[1.01]' : 'border-white/10 hover:border-white/20'}`}
        >
          {upscaleSource ? (
            <>
              <OptimizedImage src={upscaleSource.data} className="absolute inset-0 w-full h-full object-contain p-4" referrerPolicy="no-referrer" priority />
              <div className="absolute inset-0 bg-zinc-950/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                <button 
                  onClick={() => setUpscaleSource(null)}
                  className="p-4 bg-red-500 text-white rounded-full hover:scale-110 transition-transform shadow-xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center">
                <Upload className="w-10 h-10 text-zinc-500" />
              </div>
              <div className="text-center">
                <button 
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) handleFile(file);
                    };
                    input.click();
                  }}
                  className="px-8 py-4 bg-white text-zinc-950 font-bold rounded-2xl hover:bg-zinc-100 transition-all mb-4"
                >
                  Выбрать изображение
                </button>
                <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest">Или перетащите файл сюда</p>
              </div>
            </>
          )}
        </div>

        {upscaleSource && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center"
          >
            <button 
              onClick={() => handleUpscale(upscaleSource.data)}
              disabled={isUpscaling}
              className="px-12 py-5 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-500 transition-all hover:scale-105 active:scale-95 flex items-center gap-3 shadow-2xl shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-tighter"
            >
              {isUpscaling ? <Loader2 className="w-6 h-6 animate-spin" /> : <Maximize2 className="w-6 h-6" />}
              {isUpscaling ? "Улучшаем..." : `Начать апскейл (${upscaleSettings.imageSize})`}
            </button>
          </motion.div>
        )}
      </section>

      {error && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-6 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center gap-4 text-red-400"
        >
          <AlertTriangle className="w-6 h-6 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </motion.div>
      )}

      {upscaleResults.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Результаты апскейла</h3>
            <button 
              onClick={() => setUpscaleResults([])}
              className="text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              Очистить
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {upscaleResults.map((item) => (
              <UpscaleResultCard 
                key={item.id} 
                item={item} 
                onRetry={handleUpscale} 
                onFullscreen={setFullscreenImage} 
                onRefine={onRefine}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
