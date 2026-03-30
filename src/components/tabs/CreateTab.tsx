import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  X,
  ImageIcon,
  Layout,
  Upload,
  Settings,
  Sparkles,
  Loader2,
  Maximize2,
  AlertTriangle,
  LayoutGrid,
} from 'lucide-react';
import type { SceneRole } from '../../services/geminiService';
import { sceneRolesOrder } from '../../services/geminiService';
import { ResultCard } from '../ResultCard';
import { DeckImportSection } from '../DeckImportSection';
import { OptimizedImage } from '../OptimizedImage';
import type { CardLibraryEntry, ReferenceLibraryEntry } from '../../services/supabaseService';

interface CreateTabProps {
  sources: any[];
  setSources: React.Dispatch<React.SetStateAction<any[]>>;
  createLayoutMode: 'cover' | 'scene';
  onCreateLayoutModeChange: (mode: 'cover' | 'scene') => void;
  scenePlan: 2 | 3;
  onScenePlanChange: (plan: 2 | 3) => void;
  focusedSceneSlot: SceneRole;
  onFocusedSceneSlotChange: (slot: SceneRole) => void;
  onRequestSourceUploadForSlot: (slot: SceneRole) => void;
  reference: { data: string; mimeType: string } | null;
  setReference: (ref: { data: string; mimeType: string } | null) => void;
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  baseImage: { data: string; mimeType: string } | null;
  setBaseImage: (image: { data: string; mimeType: string } | null) => void;
  isGenerating: boolean;
  handleGenerate: () => Promise<void>;
  results: string[];
  isUpscaling: boolean;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  toggleLike: (url: string) => Promise<void>;
  likedSet: Set<string>;
  error: string | null;
  isDragging: boolean;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: () => void;
  handleDrop: (e: React.DragEvent) => void;
  handleLocalPaste: (e: React.ClipboardEvent, type: 'source' | 'reference') => void;
  sourceInputRef: React.RefObject<HTMLInputElement | null>;
  refInputRef: React.RefObject<HTMLInputElement | null>;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>, type: 'source' | 'reference') => void;
  handleDragOverRef: (e: React.DragEvent) => void;
  handleDragLeaveRef: () => void;
  handleDropRef: (e: React.DragEvent) => void;
  selectReferenceFromLibrary: (entry: ReferenceLibraryEntry) => Promise<void>;
  ASPECT_RATIOS: string[];
  RESOLUTIONS: string[];
  isDraggingRef: boolean;
  userReferenceLibrary: ReferenceLibraryEntry[];
  cardLibrary: CardLibraryEntry[];
  onAddCardSource: (entry: CardLibraryEntry) => void;
  onRemoveCardSource: (sourceId: string) => void;
}

const sceneRoleLabel = (r: SceneRole) =>
  r === 'left' ? 'Лево' : r === 'center' ? 'Центр' : 'Право';

export const CreateTab: React.FC<CreateTabProps> = ({
  sources,
  setSources,
  createLayoutMode,
  onCreateLayoutModeChange,
  scenePlan,
  onScenePlanChange,
  focusedSceneSlot,
  onFocusedSceneSlotChange,
  onRequestSourceUploadForSlot,
  reference,
  setReference,
  settings,
  setSettings,
  baseImage,
  setBaseImage,
  isGenerating,
  handleGenerate,
  results,
  isUpscaling,
  handleUpscale,
  setFullscreenImage,
  toggleLike,
  likedSet,
  error,
  isDragging,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleLocalPaste,
  sourceInputRef,
  refInputRef,
  promptRef,
  handleFileChange,
  handleDragOverRef,
  handleDragLeaveRef,
  handleDropRef,
  selectReferenceFromLibrary,
  ASPECT_RATIOS,
  RESOLUTIONS,
  isDraggingRef,
  userReferenceLibrary,
  cardLibrary,
  onAddCardSource,
  onRemoveCardSource,
}) => {
  const sceneRoles = sceneRolesOrder(scenePlan);
  const sceneFilled = sceneRoles.filter(r => sources.some((s: { role?: SceneRole }) => s.role === r)).length;
  const maxCover = 4;
  const maxScene = scenePlan;

  return (
    <motion.div
      key="create"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="grid grid-cols-1 lg:grid-cols-12 gap-10"
    >
      {/* Left Column: Controls */}
      <div className="lg:col-span-4 space-y-10">
          {/* Source Images */}
          <section className="space-y-6">
            <div className="flex flex-col gap-4">
              <div className="flex rounded-2xl bg-zinc-900/80 p-1 border border-white/5">
                <button
                  type="button"
                  onClick={() => onCreateLayoutModeChange('cover')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    createLayoutMode === 'cover' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Обложка
                </button>
                <button
                  type="button"
                  onClick={() => onCreateLayoutModeChange('scene')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    createLayoutMode === 'scene' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Сцена
                </button>
              </div>
              {createLayoutMode === 'scene' && (
                <div className="flex rounded-2xl bg-zinc-900/50 p-1 border border-white/5">
                  <button
                    type="button"
                    onClick={() => onScenePlanChange(2)}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      scenePlan === 2 ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    2 персонажа
                  </button>
                  <button
                    type="button"
                    onClick={() => onScenePlanChange(3)}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      scenePlan === 3 ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    3 персонажа
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                {createLayoutMode === 'cover' ? (
                  <>Исходные изображения ({sources.length}/{maxCover})</>
                ) : (
                  <>Сцена: {sceneFilled}/{maxScene}</>
                )}
              </h2>
              {sources.length > 0 && (
                <button 
                  onClick={() => setSources([])}
                  className="text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors"
                >
                  Очистить
                </button>
              )}
            </div>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={(e) => handleLocalPaste(e, 'source')}
              tabIndex={0}
              className={`${
                createLayoutMode === 'cover' ? 'grid grid-cols-2' : `grid gap-3 ${scenePlan === 2 ? 'grid-cols-2' : 'grid-cols-3'}`
              } gap-4 p-3 rounded-[2.5rem] transition-all bg-zinc-900/50 border-2 outline-none focus:ring-2 focus:ring-indigo-500/50 ${isDragging ? 'bg-indigo-500/10 border-indigo-500/50 scale-[1.02]' : 'border-white/5'}`}
            >
              {createLayoutMode === 'cover' ? (
                <>
                  {sources.map((src: { id: string; data: string }) => (
                    <motion.div 
                      layoutId={src.id}
                      key={src.id} 
                      className="relative group aspect-square rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 shadow-sm cursor-pointer"
                      onClick={() => setFullscreenImage(src.data)}
                    >
                      <OptimizedImage src={src.data} alt="Source" className="w-full h-full object-cover" referrerPolicy="no-referrer" priority />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => setSources((prev: any[]) => prev.filter(s => s.id !== src.id))}
                          className="p-2 bg-red-500 text-white rounded-xl hover:scale-110 transition-transform shadow-md"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                  {sources.length < maxCover && (
                    <button 
                      type="button"
                      onClick={() => sourceInputRef.current?.click()}
                      className="aspect-square rounded-3xl border-2 border-dashed border-white/10 hover:border-indigo-500/50 hover:bg-white/5 transition-all flex flex-col items-center justify-center gap-3 text-zinc-500 hover:text-indigo-400 group"
                    >
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Plus className="w-6 h-6" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Загрузить</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  {sceneRoles.map(role => {
                    const src = sources.find((s: { role?: SceneRole }) => s.role === role);
                    const isFocused = focusedSceneSlot === role;
                    return (
                      <div
                        key={role}
                        role="presentation"
                        onClick={() => onFocusedSceneSlotChange(role)}
                        className={`flex flex-col gap-2 min-w-0 ${isFocused ? 'ring-2 ring-indigo-500/60 rounded-3xl p-1 -m-1' : ''}`}
                      >
                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 text-center">
                          {sceneRoleLabel(role)}
                        </span>
                        {src ? (
                          <motion.div 
                            layoutId={src.id}
                            className="relative group aspect-square rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 shadow-sm cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFullscreenImage(src.data);
                            }}
                          >
                            <OptimizedImage src={src.data} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" priority />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                              <button 
                                type="button"
                                onClick={() => setSources((prev: any[]) => prev.filter(s => s.id !== src.id))}
                                className="p-2 bg-red-500 text-white rounded-xl hover:scale-110 transition-transform shadow-md"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          <button 
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onRequestSourceUploadForSlot(role);
                            }}
                            className="aspect-square rounded-3xl border-2 border-dashed border-white/10 hover:border-indigo-500/50 hover:bg-white/5 transition-all flex flex-col items-center justify-center gap-2 text-zinc-500 hover:text-indigo-400 group"
                          >
                            <Plus className="w-6 h-6" />
                            <span className="text-[9px] font-black uppercase tracking-widest px-1">В слот</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 text-center uppercase tracking-[0.3em] font-black">
              {createLayoutMode === 'scene'
                ? 'Клик по слоту — фокус; вставка и файлы идут в выбранный или первый пустой'
                : 'Перетащите сюда или Ctrl+V'}
            </p>
            <input 
              type="file" 
              ref={sourceInputRef} 
              className="hidden" 
              multiple={createLayoutMode === 'cover'}
              accept="image/*" 
              onChange={(e) => handleFileChange(e, 'source')} 
            />
          </section>

          {/* Reference Composition */}
          <section className="space-y-6">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
              <Layout className="w-4 h-4" />
              Референс композиции
            </h2>
            <div 
              onDragOver={handleDragOverRef}
              onDragLeave={handleDragLeaveRef}
              onDrop={handleDropRef}
              onPaste={(e) => handleLocalPaste(e, 'reference')}
              tabIndex={0}
              className={`space-y-4 p-3 rounded-[2.5rem] transition-all outline-none focus:ring-2 focus:ring-indigo-500/50 ${isDraggingRef ? 'bg-indigo-500/10 border-2 border-dashed border-indigo-500/50 scale-[1.02]' : 'bg-transparent border-2 border-transparent'}`}
            >
              {reference ? (
                <div 
                  className="relative group aspect-video rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 shadow-md cursor-pointer"
                  onClick={() => setFullscreenImage(reference.data)}
                >
                  <OptimizedImage src={reference.data} alt="Reference" className="w-full h-full object-cover" referrerPolicy="no-referrer" priority />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <button 
                      onClick={() => setReference(null)}
                      className="p-3 bg-red-500 text-white rounded-2xl hover:scale-110 transition-transform shadow-md"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {userReferenceLibrary.length > 0 && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Мои референсы</p>
                  )}
                  <div className="grid grid-cols-5 gap-3">
                    {userReferenceLibrary.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => selectReferenceFromLibrary(entry)}
                        className="aspect-square rounded-xl overflow-hidden border border-indigo-500/30 hover:border-indigo-500/60 transition-all group relative shadow-sm"
                        title={entry.name}
                      >
                        <OptimizedImage src={entry.storageUrl} alt={entry.name} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => refInputRef.current?.click()}
                      className="aspect-square rounded-xl border border-dashed border-white/10 flex items-center justify-center text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/50 bg-white/5 self-stretch min-h-0"
                    >
                      <Upload className="w-5 h-5 shrink-0" />
                    </button>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-zinc-500 text-center uppercase tracking-[0.3em] font-black">
                Перетащите или Ctrl+V референс
              </p>
            </div>
            <input 
              type="file" 
              ref={refInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={(e) => handleFileChange(e, 'reference')} 
            />
          </section>

          {/* Settings */}
          <section className="space-y-8 bg-zinc-900/50 p-8 rounded-[2.5rem] border border-white/5 shadow-sm">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Настройки
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Модель</label>
                <div className="flex flex-col gap-2">
                  {[
                    { id: "gemini-2.5-flash-image", name: "2.5 Flash (Самая быстрая)" },
                    { id: "gemini-3.1-flash-image-preview", name: "3.1 Flash (Быстрая)" },
                    { id: "gemini-3-pro-image-preview", name: "3 Pro (Качество)" }
                  ].map(m => (
                    <button 
                      key={m.id}
                      onClick={() => setSettings((s: any) => ({ 
                        ...s, 
                        model: m.id,
                        imageSize: (m.id === "gemini-3-pro-image-preview" && s.imageSize === "512px") ? "1K" : s.imageSize
                      }))}
                      className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all text-left border ${settings.model === m.id ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Формат</label>
                <div className="flex flex-wrap gap-2">
                  {ASPECT_RATIOS.map(ratio => (
                    <button 
                      key={ratio}
                      onClick={() => setSettings((s: any) => ({ ...s, aspectRatio: ratio as any }))}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${settings.aspectRatio === ratio ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Разрешение</label>
                <div className="flex flex-wrap gap-2">
                  {RESOLUTIONS.map(res => {
                    const isDisabled = settings.model === "gemini-3-pro-image-preview" && res === "512px";
                    return (
                      <button 
                        key={res}
                        disabled={isDisabled}
                        onClick={() => setSettings((s: any) => ({ ...s, imageSize: res as any }))}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${isDisabled ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/5 text-zinc-600' : settings.imageSize === res ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                      >
                        {res}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  {baseImage ? "Инструкции по доработке" : "Промпт (необязательно)"}
                </label>
                {baseImage && (
                  <div 
                    className="relative group aspect-video rounded-2xl overflow-hidden bg-zinc-900 border border-indigo-500/30 mb-3 shadow-md cursor-pointer"
                    onClick={() => setFullscreenImage(baseImage.data)}
                  >
                    <OptimizedImage src={baseImage.data} alt="Base" className="w-full h-full object-cover" referrerPolicy="no-referrer" priority />
                    <div className="absolute inset-0 bg-zinc-950/60 flex items-center justify-center pointer-events-none">
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 bg-zinc-900/90 px-3 py-1.5 rounded-xl border border-indigo-500/20 shadow-sm">Доработка этого фото</span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setBaseImage(null); }}
                      className="absolute top-3 right-3 p-2 bg-red-500 text-white rounded-xl hover:scale-110 transition-transform shadow-md z-10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <textarea 
                  ref={promptRef}
                  value={settings.prompt}
                  onChange={(e) => setSettings((s: any) => ({ ...s, prompt: e.target.value }))}
                  placeholder={baseImage ? "Опишите, что изменить или добавить..." : "напр. Кинематографичное освещение, стиль фэнтези..."}
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/30 min-h-[100px] resize-none transition-all shadow-inner"
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Отрицательный промпт</label>
                <input 
                  type="text"
                  value={settings.negativePrompt}
                  onChange={(e) => setSettings((s: any) => ({ ...s, negativePrompt: e.target.value }))}
                  placeholder="напр. текст, логотип, размытость"
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/30 transition-all shadow-inner"
                />
              </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Вариантов: {settings.batchSize}</label>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="4" 
                    value={settings.batchSize}
                    onChange={(e) => setSettings((s: any) => ({ ...s, batchSize: parseInt(e.target.value) }))}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
                  <div className="space-y-1 min-w-0 flex-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Максимальная точность</label>
                    <p className="text-[10px] text-zinc-500">
                      Анализ исходников (vision), жёсткий промпт и проверка результата; при провале — одна доработка (Nano Banana 2)
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.strictMode}
                    onClick={() => setSettings((s: any) => ({ ...s, strictMode: !s.strictMode }))}
                    className={`relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border border-white/10 p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${settings.strictMode ? 'bg-indigo-600' : 'bg-zinc-700'}`}
                  >
                    <span
                      className={`pointer-events-none block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ease-out ${settings.strictMode ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>

              </div>
          </section>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 space-y-6">
          {/* Deck Import */}
          <DeckImportSection
            cardLibrary={cardLibrary}
            sources={sources}
            onAddSource={onAddCardSource}
            onRemoveSource={onRemoveCardSource}
            createLayoutMode={createLayoutMode}
            scenePlan={scenePlan}
          />

          <AnimatePresence mode="wait">
            {isGenerating ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="bg-zinc-900/50 rounded-[3rem] border border-white/5 min-h-[600px] flex items-center justify-center shadow-sm"
              >
                <div className="flex flex-col items-center gap-8 text-center p-10">
                  <div className="relative">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="w-32 h-32 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full"
                    />
                    <Sparkles className="w-10 h-10 text-indigo-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-3xl font-black tracking-tighter text-white">Создаем шедевр...</h3>
                    <p className="text-zinc-500 text-lg max-w-sm">Анализируем цвета, объекты и композицию для вашей уникальной обложки.</p>
                  </div>
                </div>
              </motion.div>
            ) : results.length > 0 ? (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="relative"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {results.map((url, i) => (
                    <ResultCard
                      key={i}
                      url={url}
                      isLiked={likedSet.has(url)}
                      onToggleLike={toggleLike}
                      onUpscale={handleUpscale}
                      onFullscreen={setFullscreenImage}
                      onRefine={(url) => {
                        setBaseImage({ data: url, mimeType: 'image/png' });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        setTimeout(() => promptRef.current?.focus(), 100);
                      }}
                      onDownload={(url) => {
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `cover-${i}.png`;
                        link.click();
                      }}
                    />
                  ))}
                </div>

                {isUpscaling && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6 rounded-[2rem]"
                  >
                    <div className="relative">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="w-24 h-24 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full"
                      />
                      <Maximize2 className="w-8 h-8 text-indigo-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter">Улучшаем качество...</h3>
                      <p className="text-zinc-400 text-sm">Масштабируем изображение до 4K с ИИ</p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-zinc-900/50 rounded-[3rem] border border-white/5 min-h-[600px] flex items-center justify-center shadow-sm"
              >
                <div className="flex flex-col items-center gap-8 text-center p-10">
                  <div className="w-24 h-24 bg-zinc-900 rounded-[2rem] flex items-center justify-center border border-white/5 shadow-inner">
                    <ImageIcon className="w-12 h-12 text-zinc-800" />
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-3xl font-black tracking-tighter text-zinc-700">Готов к созданию</h3>
                    <p className="text-zinc-500 text-lg max-w-xs">Загрузите 2-4 изображения и нажмите «Создать», чтобы увидеть магию.</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="p-5 bg-red-500/10 border border-red-500/20 rounded-[2rem] text-red-500 text-sm flex items-center gap-4 shadow-sm"
              >
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                <span className="font-bold">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tips */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Связность", desc: "Используйте фото с похожим светом для лучшего результата." },
              { title: "Композиция", desc: "Загрузите референс, чтобы направить макет ИИ." },
              { title: "Качество", desc: "Высокое разрешение требует больше времени, но выглядит четче." }
            ].map((tip, i) => (
              <div key={i} className="p-6 rounded-[2rem] bg-zinc-900/50 border border-white/5 shadow-sm hover:shadow-md transition-all">
                <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">{tip.title}</h4>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">{tip.desc}</p>
              </div>
            ))}
          </div>
        </div>
    </motion.div>
  );
};
