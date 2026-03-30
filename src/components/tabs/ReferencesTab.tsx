import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Images, Plus, X, Trash2, Upload, Loader2, AlertTriangle } from 'lucide-react';
import type { ReferenceLibraryEntry } from '../../services/supabaseService';
import { isSupabaseConfigured, formatSupabaseClientError } from '../../services/supabaseService';

interface ReferencesTabProps {
  referenceLibrary: ReferenceLibraryEntry[];
  onSaveReference: (name: string, imageData: string, mimeType: string) => Promise<void>;
  onDeleteReference: (id: string, storagePath: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  isSaving: boolean;
}

export const ReferencesTab: React.FC<ReferencesTabProps> = ({
  referenceLibrary,
  onSaveReference,
  onDeleteReference,
  setFullscreenImage,
  isSaving,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formImage, setFormImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      setSaveError(formatSupabaseClientError(e) || 'Ошибка сохранения');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormName('');
    setFormImage(null);
    setSaveError(null);
  };

  return (
    <motion.div
      key="references"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-10"
    >
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
                      <img src={formImage.data} className="max-h-40 object-contain p-2" alt="" referrerPolicy="no-referrer" />
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

      {referenceLibrary.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {referenceLibrary.map(entry => (
            <motion.div key={entry.id} layout className="group relative rounded-[1.5rem] overflow-hidden bg-zinc-900 border border-white/5">
              <button type="button" className="w-full block" onClick={() => setFullscreenImage(entry.storageUrl)}>
                <img src={entry.storageUrl} alt={entry.name} className="w-full h-auto object-cover aspect-video" referrerPolicy="no-referrer" />
              </button>
              <div className="p-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white truncate">{entry.name}</span>
                <button type="button" onClick={() => onDeleteReference(entry.id, entry.storagePath)} className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg shrink-0" title="Удалить"><Trash2 className="w-4 h-4" /></button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="h-[320px] flex flex-col items-center justify-center rounded-[2rem] border border-white/5 bg-zinc-900/30 text-zinc-500 text-sm">
          Пока нет сохранённых референсов
        </div>
      )}
    </motion.div>
  );
};