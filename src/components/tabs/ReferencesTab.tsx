import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Images, Plus, X, Trash2, Upload, Loader2, AlertTriangle, Settings } from 'lucide-react';
import type { ReferenceLibraryEntry } from '../../services/supabaseService';
import { OptimizedImage } from '../OptimizedImage';
import { isSupabaseConfigured, formatSupabaseClientError } from '../../services/supabaseService';
import {
  PreviewScaleSlider,
  ScaledResultGrid,
  useResultPreviewScaleFromStorage,
} from '../ui/ResultPreviewScale';

interface ReferencesTabProps {
  referenceLibrary: ReferenceLibraryEntry[];
  onSaveReference: (name: string, imageData: string, mimeType: string) => Promise<void>;
  onDeleteReference: (id: string, storagePath: string) => Promise<void>;
  onReanalyzeReference: (entry: ReferenceLibraryEntry) => Promise<void>;
  reanalyzingReferenceId: string | null;
  setFullscreenImage: (url: string | null) => void;
  isSaving: boolean;
}

export const ReferencesTab: React.FC<ReferencesTabProps> = ({
  referenceLibrary,
  onSaveReference,
  onDeleteReference,
  onReanalyzeReference,
  reanalyzingReferenceId,
  setFullscreenImage,
  isSaving,
}) => {
  const [settingsEntry, setSettingsEntry] = useState<ReferenceLibraryEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formImage, setFormImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pct: previewScalePct, setPct: setPreviewScalePct, scale: previewScale } =
    useResultPreviewScaleFromStorage();

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onloadend = () => setFormImage({ data: reader.result as string, mimeType: file.type });
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formImage) {
      setSaveError('Укажите название и изображение.');
      return;
    }
    setSaveError(null);
    try {
      await onSaveReference(formName.trim(), formImage.data, formImage.mimeType);
      setFormName('');
      setFormImage(null);
      setShowForm(false);
    } catch (e: unknown) {
      const msg = formatSupabaseClientError(e).trim() || 'Ошибка сохранения';
      setSaveError(msg);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormName('');
    setFormImage(null);
    setSaveError(null);
  };

  const detailEntry = settingsEntry
    ? referenceLibrary.find(e => e.id === settingsEntry.id) ?? settingsEntry
    : null;

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black tracking-tighter text-white">Референсы</h2>
          <p className="text-zinc-500 mt-2">
            Сохраняйте композиции для быстрого выбора на вкладке «Создать»
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95 ${showForm ? 'bg-zinc-800 text-zinc-400' : 'bg-white text-zinc-950 shadow-xl shadow-white/10'}`}
        >
          <Plus className="w-4 h-4" />
          Добавить референс
        </button>
      </div>

      {!isSupabaseConfigured && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-3xl flex items-start gap-4 text-amber-400">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold mb-1">Нужен Supabase</p>
            <p className="text-amber-500/80 text-xs">Те же переменные, что и для библиотеки карт. Создайте таблицу reference_library (см. supabase/rls-anon-policies.sql).</p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-zinc-900/70 border border-white/10 rounded-[2.5rem] p-8 space-y-6"
          >
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-2">
              <Images className="w-4 h-4" />
              Новый референс
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Название</label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="напр. Дуэль справа"
                  className="w-full bg-zinc-950/80 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Изображение</label>
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  onPaste={e => {
                    for (let i = 0; i < (e.clipboardData?.items?.length ?? 0); i++) {
                      const it = e.clipboardData.items[i];
                      if (it.type.startsWith('image/')) {
                        const file = it.getAsFile();
                        if (file) { handleFile(file); e.preventDefault(); e.stopPropagation(); }
                      }
                    }
                  }}
                  tabIndex={0}
                  onClick={() => !formImage && fileRef.current?.click()}
                  className={`relative rounded-3xl border-2 border-dashed min-h-[140px] flex items-center justify-center cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/30 ${isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/10 bg-zinc-950/50'}`}
                >
                  {formImage ? (
                    <>
                      <OptimizedImage src={formImage.data} className="max-h-40 object-contain p-2" alt="" referrerPolicy="no-referrer" priority />
                      <button type="button" onClick={ev => { ev.stopPropagation(); setFormImage(null); }} className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full"><X className="w-3 h-3" /></button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-500 text-xs"><Upload className="w-8 h-8" />Файл или Ctrl+V</div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            </div>
            {saveError && <p className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{saveError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={handleCancel} className="px-6 py-2.5 text-sm font-bold text-zinc-400">Отмена</button>
              <button type="button" onClick={handleSave} disabled={isSaving || !isSupabaseConfigured} className="px-8 py-2.5 bg-white text-zinc-950 font-black rounded-2xl text-sm disabled:opacity-50">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Сохранить'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-zinc-950/90 backdrop-blur-md"
            onClick={() => setSettingsEntry(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-zinc-900 border border-white/10 rounded-[2rem] shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-white/5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Анализ референса</p>
                  <h3 className="text-lg font-black text-white mt-1 truncate pr-4">{detailEntry.name}</h3>
                </div>
                <button type="button" onClick={() => setSettingsEntry(null)} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 min-h-0">
                {detailEntry.visionAnalysis ? (
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed break-words">
                    {detailEntry.visionAnalysis}
                  </pre>
                ) : (
                  <p className="text-sm text-zinc-500">Анализ ещё не выполнен. Нажмите «Пересчитать анализ» или дождитесь завершения после сохранения.</p>
                )}
              </div>
              <div className="p-6 border-t border-white/5 flex flex-wrap gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => onReanalyzeReference(detailEntry)}
                  disabled={!isSupabaseConfigured || reanalyzingReferenceId === detailEntry.id}
                  className="px-6 py-2.5 rounded-2xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2"
                >
                  {reanalyzingReferenceId === detailEntry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Пересчитать анализ
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {referenceLibrary.length > 0 ? (
        <div className="space-y-4">
          <PreviewScaleSlider value={previewScalePct} onChange={setPreviewScalePct} />
          <ScaledResultGrid scale={previewScale}>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 items-start">
          {referenceLibrary.map(entry => (
            <motion.div key={entry.id} layout className="group relative w-full rounded-[1.5rem] overflow-hidden bg-zinc-900 border border-white/5">
              <button type="button" className="w-full block" onClick={() => setFullscreenImage(entry.storageUrl)}>
                <OptimizedImage src={entry.storageUrl} alt={entry.name} className="w-full h-auto object-cover aspect-video" referrerPolicy="no-referrer" />
                {entry.visionAnalysis && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-indigo-600/90 text-[9px] font-black uppercase text-white">AI</span>
                )}
              </button>
              <div className="p-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white truncate">{entry.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsEntry(entry)}
                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg"
                    title="Настройки / анализ"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => onDeleteReference(entry.id, entry.storagePath)} className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg" title="Удалить"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </motion.div>
          ))}
            </div>
          </ScaledResultGrid>
        </div>
      ) : (
        <div className="h-[320px] flex flex-col items-center justify-center rounded-[2rem] border border-white/5 bg-zinc-900/30 text-zinc-500 text-sm">
          Пока нет сохранённых референсов
        </div>
      )}
    </div>
  );
};