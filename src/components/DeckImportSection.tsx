import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { OptimizedImage } from './OptimizedImage';
import { ChevronDown, ChevronUp, Layers, Search, Loader2, X, Check } from 'lucide-react';
import type { CardLibraryEntry } from '../services/serverStorageService';
import { findLibraryCardsInDeck } from '../services/hearthstoneService';

interface DeckImportSectionProps {
  cardLibrary: CardLibraryEntry[];
  sources: Array<{ id: string; data: string; mimeType: string; role?: string }>;
  onAddSource: (entry: CardLibraryEntry) => void;
  onRemoveSource: (entryId: string) => void;
  createLayoutMode?: 'cover' | 'scene';
  scenePlan?: 2 | 3;
}

export const DeckImportSection: React.FC<DeckImportSectionProps> = ({
  cardLibrary,
  sources,
  onAddSource,
  onRemoveSource,
  createLayoutMode = 'cover',
  scenePlan = 3,
}) => {
  const maxSources = createLayoutMode === 'cover' ? 4 : scenePlan;
  const [isOpen, setIsOpen] = useState(false);
  const [deckstring, setDeckstring] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<Array<{ entry: CardLibraryEntry; count: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!deckstring.trim()) return;
    if (!cardLibrary.length) {
      setError('Библиотека карт пуста. Добавьте карты во вкладке «Библиотека».');
      return;
    }
    setError(null);
    setIsSearching(true);
    setResults(null);
    try {
      const found = await findLibraryCardsInDeck(deckstring.trim(), cardLibrary);
      setResults(found);
      if (found.length === 0) setError('Карты из библиотеки в этой колоде не найдены.');
    } catch (e: any) {
      setError(`Ошибка декодирования: ${e.message || 'неверный формат deckstring'}`);
    } finally {
      setIsSearching(false);
    }
  };

  const toggleCard = (entry: CardLibraryEntry) => {
    const isSelected = sources.some(s => s.id === `lib_${entry.id}`);
    if (isSelected) {
      onRemoveSource(`lib_${entry.id}`);
    } else {
      if (sources.length >= maxSources) return;
      onAddSource(entry);
    }
  };

  const isCardSelected = (entry: CardLibraryEntry) =>
    sources.some(s => s.id === `lib_${entry.id}`);

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-[2.5rem] overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setIsOpen(s => !s)}
        className="w-full flex items-center justify-between px-8 py-5 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20">
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-left">
            <span className="text-sm font-black text-white">Импорт колоды</span>
            {!isOpen && sources.filter(s => s.id.startsWith('lib_')).length > 0 && (
              <span className="ml-2 text-[10px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                {sources.filter(s => s.id.startsWith('lib_')).length} выбрано
              </span>
            )}
          </div>
        </div>
        {isOpen ? <ChevronUp className="w-5 h-5 text-zinc-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-8 pb-8 space-y-6 border-t border-white/5 pt-6">
              {/* Deckstring input */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Deckstring Hearthstone</label>
                <div className="flex gap-3">
                  <textarea
                    value={deckstring}
                    onChange={e => setDeckstring(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
                    placeholder="Вставьте код колоды из Hearthstone..."
                    rows={2}
                    className="flex-1 bg-zinc-950/80 border border-white/5 rounded-2xl px-4 py-3 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all resize-none font-mono"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={isSearching || !deckstring.trim()}
                    className="px-5 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-500 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 self-end text-sm shrink-0"
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    {isSearching ? 'Ищем...' : 'Найти'}
                  </button>
                </div>
                {cardLibrary.length === 0 && (
                  <p className="text-[10px] text-zinc-600">Сначала добавьте карты во вкладке «Библиотека»</p>
                )}
              </div>

              {/* Error */}
              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-amber-400 font-medium flex items-center gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {error}
                </motion.p>
              )}

              {/* Results */}
              <AnimatePresence>
                {results !== null && results.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        Найдено {results.length} {results.length === 1 ? 'карта' : results.length < 5 ? 'карты' : 'карт'} из библиотеки
                      </p>
                      <p className="text-[10px] text-zinc-600">
                        Нажмите чтобы добавить в источники ({sources.length}/{maxSources})
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 items-start">
                      {results.map(({ entry, count }) => {
                        const selected = isCardSelected(entry);
                        const canAdd = sources.length < maxSources || selected;
                        return (
                          <motion.button
                            key={entry.id}
                            layout
                            onClick={() => canAdd && toggleCard(entry)}
                            disabled={!canAdd && !selected}
                            className={`relative group w-full rounded-2xl overflow-hidden border-2 transition-all text-left ${
                              selected
                                ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
                                : canAdd
                                ? 'border-white/5 hover:border-white/20'
                                : 'border-white/5 opacity-40 cursor-not-allowed'
                            }`}
                          >
                            <OptimizedImage
                              src={entry.storageUrl}
                              alt={entry.name}
                              className={`w-full h-auto block transition-transform duration-500 ${selected ? 'scale-105' : 'group-hover:scale-105'}`}
                              referrerPolicy="no-referrer"
                            />
                            {/* Overlay */}
                            <div className={`absolute inset-0 transition-all ${selected ? 'bg-indigo-500/20' : 'bg-transparent'}`} />
                            {/* Selected checkmark */}
                            {selected && (
                              <div className="absolute top-2 right-2 w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center shadow-lg">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                            {/* Count badge */}
                            {count > 1 && (
                              <div className="absolute top-2 left-2 px-2 py-0.5 bg-zinc-950/80 text-white text-[9px] font-black rounded-full border border-white/10">
                                ×{count}
                              </div>
                            )}
                            {/* Name */}
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-zinc-950/90 to-transparent p-2">
                              <p className="text-white text-[9px] font-bold leading-tight truncate">{entry.name}</p>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>

                    {/* Clear deck selection */}
                    {sources.some(s => s.id.startsWith('lib_')) && (
                      <button
                        onClick={() => {
                          sources.filter(s => s.id.startsWith('lib_')).forEach(s => onRemoveSource(s.id));
                        }}
                        className="text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors flex items-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        Снять выделение
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
