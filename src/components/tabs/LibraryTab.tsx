import React, { useState, useRef } from 'react';
import { OptimizedImage } from '../OptimizedImage';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Plus, X, Trash2, Upload, Loader2, AlertTriangle } from 'lucide-react';
import type { CardLibraryEntry } from '../../services/supabaseService';
import { isSupabaseConfigured, formatSupabaseClientError } from '../../services/supabaseService';

interface LibraryTabProps {
  cardLibrary: CardLibraryEntry[];
  onSaveCard: (name: string, cardId: string, imageData: string, mimeType: string) => Promise<void>;
  onDeleteCard: (id: string, storagePath: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  isSaving: boolean;
}

export const LibraryTab: React.FC<LibraryTabProps> = ({
  cardLibrary,
  onSaveCard,
  onDeleteCard,
  setFullscreenImage,
  isSaving,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCardId, setFormCardId] = useState('');
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
    if (!formName.trim() || !formCardId.trim() || !formImage) {
      setSaveError('Заполните все поля и загрузите арт.');
      return;
    }
    setSaveError(null);
    try {
      await onSaveCard(formName.trim(), formCardId.trim(), formImage.data, formImage.mimeType);
      setFormName('');
      setFormCardId('');
      setFormImage(null);
      setShowForm(false);
    } catch (e: unknown) {
      setSaveError(formatSupabaseClientError(e) || 'Ошибка сохранения');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormName('');
    setFormCardId('');
    setFormImage(null);
    setSaveError(null);
  };

  return (
    <motion.div
      key="library"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-10"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black tracking-tighter text-white">Библиотека карт</h2>
          <p className="text-zinc-500 mt-2">
            {cardLibrary.length > 0
              ? `${cardLibrary.length} ${cardLibrary.length === 1 ? 'карта' : cardLibrary.length < 5 ? 'карты' : 'карт'} в библиотеке`
              : 'Добавьте арты карт Hearthstone'}
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95 ${showForm ? 'bg-zinc-800 text-zinc-400' : 'bg-white text-zinc-950 shadow-xl shadow-white/10'}`}
        >
          <Plus className="w-4 h-4" />
          Добавить карту
        </button>
      </div>

      {/* Supabase warning */}
      {!isSupabaseConfigured && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-3xl flex items-start gap-4 text-amber-400">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold mb-1">Supabase не настроен</p>
            <p className="text-amber-500/80 text-xs leading-relaxed space-y-2">
              <span className="block">
                Библиотека карт требует Supabase. В Vercel → Environment Variables задайте оба значения и сделайте <strong className="text-amber-400">Redeploy</strong>.
              </span>
              <span className="block">
                <code className="bg-amber-500/10 px-1 rounded">VITE_SUPABASE_URL</code> — полный URL вида{' '}
                <code className="bg-amber-500/10 px-1 rounded">https://&lt;project-ref&gt;.supabase.co</code> (не только id проекта).
              </span>
              <span className="block">
                <code className="bg-amber-500/10 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> — <strong className="text-amber-400">Publishable key</strong> (начинается с{' '}
                <code className="bg-amber-500/10 px-1 rounded">sb_publishable_</code>) или старый <strong className="text-amber-400">anon public</strong> JWT (вкладка Legacy). <strong className="text-amber-400">Secret key</strong> в браузер не вставлять.
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Add card form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-zinc-900/70 border border-white/10 rounded-[2.5rem] p-8 space-y-6"
          >
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Новая карта
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: inputs */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Название карты</label>
                  <input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="напр. Sol'etos"
                    className="w-full bg-zinc-950/80 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Код карты (Card ID)</label>
                  <input
                    value={formCardId}
                    onChange={e => setFormCardId(e.target.value)}
                    placeholder="напр. TLC_817t5"
                    className="w-full bg-zinc-950/80 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all font-mono"
                  />
                  <p className="text-[10px] text-zinc-600">Код используется для поиска карт в колоде</p>
                </div>
              </div>

              {/* Right: image upload */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Арт карты</label>
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file) handleFile(file);
                  }}
                  onPaste={e => {
                    for (let i = 0; i < (e.clipboardData?.items?.length ?? 0); i++) {
                      const item = e.clipboardData.items[i];
                      if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (file) {
                          handleFile(file);
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }
                    }
                  }}
                  tabIndex={0}
                  onClick={() => !formImage && fileRef.current?.click()}
                  className={`relative rounded-3xl border-2 border-dashed transition-all overflow-hidden cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/30 flex items-center justify-center min-h-[160px] ${isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/10 hover:border-white/20 bg-zinc-950/50'}`}
                >
                  {formImage ? (
                    <>
                      <OptimizedImage src={formImage.data} className="w-full h-auto block max-h-48 object-contain p-2" referrerPolicy="no-referrer" priority />
                      <button
                        onClick={e => { e.stopPropagation(); setFormImage(null); }}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:scale-110 transition-transform shadow"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-3 p-6 text-center">
                      <Upload className="w-8 h-8 text-zinc-600" />
                      <p className="text-xs text-zinc-500 font-medium">Нажмите, перетащите или Ctrl+V</p>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            </div>

            {saveError && (
              <p className="text-sm text-red-400 font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {saveError}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={handleCancel} className="px-6 py-2.5 rounded-2xl text-sm font-bold text-zinc-400 hover:text-white transition-colors">
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !isSupabaseConfigured}
                className="px-8 py-2.5 bg-white text-zinc-950 font-black rounded-2xl hover:bg-zinc-100 transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {isSaving ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card grid */}
      {cardLibrary.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {cardLibrary.map(entry => (
            <motion.div
              key={entry.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="group relative rounded-[1.5rem] overflow-hidden bg-zinc-900 border border-white/5 shadow-md hover:shadow-indigo-500/10 transition-all cursor-pointer"
              onClick={() => setFullscreenImage(entry.storageUrl)}
            >
              <OptimizedImage
                src={entry.storageUrl}
                alt={entry.name}
                className="w-full h-auto block group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              {/* Card info overlay */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/30 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3 gap-1">
                <p className="text-white font-bold text-xs leading-tight">{entry.name}</p>
                <p className="text-zinc-400 font-mono text-[9px]">{entry.cardId}</p>
              </div>
              {/* Delete button */}
              <div className="pointer-events-auto absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); onDeleteCard(entry.id, entry.storagePath); }}
                  className="p-1.5 bg-red-500 text-white rounded-xl hover:scale-110 transition-transform shadow-lg"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        !showForm && (
          <div className="h-[400px] flex flex-col items-center justify-center text-center space-y-6 bg-zinc-900/50 rounded-[3rem] border border-white/5">
            <div className="w-24 h-24 bg-zinc-900 rounded-[2rem] flex items-center justify-center border border-white/5">
              <BookOpen className="w-12 h-12 text-zinc-800" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black tracking-tighter text-zinc-600">Библиотека пуста</h3>
              <p className="text-zinc-500 max-w-xs text-sm">
                Добавьте арты карт Hearthstone — они появятся при совпадении с кодом колоды.
              </p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="px-8 py-3 bg-white text-zinc-950 font-bold rounded-2xl hover:bg-zinc-100 transition-all text-sm"
            >
              + Добавить первую карту
            </button>
          </div>
        )
      )}
    </motion.div>
  );
};
