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
  AlertTriangle,
  MoveHorizontal
} from 'lucide-react';
import { UpscaleResultCard } from '../UpscaleResultCard';
import { OptimizedImage } from '../OptimizedImage';
import { UPSCALE_EXPAND_MODELS } from '../../constants';
import {
  PreviewScaleSlider,
  ScaledResultGrid,
  useResultPreviewScaleFromStorage,
} from '../ui/ResultPreviewScale';

interface ExpandTabProps {
  expandSource: { data: string; mimeType: string } | null;
  setExpandSource: (source: { data: string; mimeType: string } | null) => void;
  expandSettings: { model: string; aspectRatio: string; prompt: string };
  setExpandSettings: React.Dispatch<React.SetStateAction<{ model: string; aspectRatio: string; prompt: string }>>;
  isExpanding: boolean;
  handleExpand: (url: string) => Promise<void>;
  expandResults: any[];
  setExpandResults: React.Dispatch<React.SetStateAction<any[]>>;
  setFullscreenImage: (url: string | null) => void;
  onRefine: (url: string) => void;
  error: string | null;
  ASPECT_RATIOS: string[];
}

export const ExpandTab: React.FC<ExpandTabProps> = ({
  expandSource,
  setExpandSource,
  expandSettings,
  setExpandSettings,
  isExpanding,
  handleExpand,
  expandResults,
  setExpandResults,
  setFullscreenImage,
  onRefine,
  error,
  ASPECT_RATIOS
}) => {
  const [showExpandSettings, setShowExpandSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { pct: previewScalePct, setPct: setPreviewScalePct, scale: previewScale } =
    useResultPreviewScaleFromStorage();

  const handleFile = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setExpandSource({ data: reader.result as string, mimeType: file.type });
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-12">
      <section className="space-y-6 text-center">
        <h2 className="text-3xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">
          Изменение формата (Expansion)
        </h2>
        <p className="text-zinc-400">
          Достройте края изображения до нужного формата (например, 16:9) с помощью ИИ.
        </p>
      </section>

      <section className="bg-zinc-900/50 border border-white/5 rounded-[2.5rem] p-8 space-y-8">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-300 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Настройки расширения
          </h3>
          <button 
            onClick={() => setShowExpandSettings(!showExpandSettings)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500"
          >
            {showExpandSettings ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>

        <AnimatePresence>
          {showExpandSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-8"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                <div className="space-y-4">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Модель</label>
                  <div className="flex flex-col gap-2">
                    {UPSCALE_EXPAND_MODELS.map(m => (
                      <button 
                        key={m.id}
                        onClick={() => setExpandSettings(s => ({ ...s, model: m.id }))}
                        className={`p-4 rounded-2xl text-left transition-all border ${expandSettings.model === m.id ? 'bg-white border-white text-zinc-950 shadow-lg' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                      >
                        <div className="font-bold text-xs">{m.label}</div>
                        <div className={`text-[10px] mt-1 ${expandSettings.model === m.id ? 'text-zinc-500' : 'text-zinc-600'}`}>{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Целевой формат</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASPECT_RATIOS.map(ratio => (
                      <button 
                        key={ratio}
                        onClick={() => setExpandSettings(s => ({ ...s, aspectRatio: ratio }))}
                        className={`p-3 rounded-xl text-center transition-all border ${expandSettings.aspectRatio === ratio ? 'bg-white border-white text-zinc-950 shadow-lg' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                      >
                        <div className="font-bold text-xs">{ratio}</div>
                      </button>
                    ))}
                  </div>
                  
                  <div className="space-y-2 pt-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Что добавить? (Опционально)</label>
                    <textarea 
                      value={expandSettings.prompt}
                      onChange={(e) => setExpandSettings(s => ({ ...s, prompt: e.target.value }))}
                      placeholder="Опишите, что должно быть на расширенных частях..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-indigo-500/50 min-h-[100px] resize-none"
                    />
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
          className={`relative aspect-video rounded-[3rem] border-2 border-dashed transition-all flex flex-col items-center justify-center gap-6 overflow-hidden bg-zinc-900/50 outline-none focus:ring-2 focus:ring-indigo-500/50 ${isDragging ? 'border-indigo-500 bg-indigo-500/5 scale-[1.01]' : 'border-white/10 hover:border-white/20'}`}
        >
          {expandSource ? (
            <>
              <OptimizedImage src={expandSource.data} className="absolute inset-0 w-full h-full object-contain p-4" referrerPolicy="no-referrer" priority />
              <div className="absolute inset-0 bg-zinc-950/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                <button 
                  onClick={() => setExpandSource(null)}
                  className="p-4 bg-red-500 text-white rounded-full hover:scale-110 transition-transform shadow-xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center">
                <MoveHorizontal className="w-10 h-10 text-zinc-500" />
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

        {expandSource && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center"
          >
            <button 
              onClick={() => handleExpand(expandSource.data)}
              disabled={isExpanding}
              className="px-12 py-5 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-500 transition-all hover:scale-105 active:scale-95 flex items-center gap-3 shadow-2xl shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-tighter"
            >
              {isExpanding ? <Loader2 className="w-6 h-6 animate-spin" /> : <Maximize2 className="w-6 h-6" />}
              {isExpanding ? "Расширяем..." : `Расширить до ${expandSettings.aspectRatio}`}
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

      {expandResults.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Результаты расширения</h3>
            <button 
              onClick={() => setExpandResults([])}
              className="text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              Очистить
            </button>
          </div>
          <PreviewScaleSlider value={previewScalePct} onChange={setPreviewScalePct} />
          <ScaledResultGrid scale={previewScale}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {expandResults.map((item) => (
                <UpscaleResultCard 
                  key={item.id} 
                  item={item} 
                  onRetry={(url) => handleExpand(url)} 
                  onFullscreen={setFullscreenImage} 
                  onRefine={onRefine}
                />
              ))}
            </div>
          </ScaledResultGrid>
        </section>
      )}
    </div>
  );
};
