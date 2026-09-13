import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ProviderModelPicker as ModelPicker, ChatGptImageNotice, useChatGpt } from '../ui/ChatGptConnection';
import { thumbnailModelOptions } from '../../features/models/options';
import '../../styles/thumbnail.css';
import {
  Check,
  Download,
  Frame,
  Gamepad2,
  ImagePlus,
  Loader2,
  Palette,
  Search,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { generateHearthstoneThumbnailBackgrounds } from '../../services/thumbnailService';
import { searchHearthstoneAssets } from '../../services/hearthstoneAssetService';
import { exportThumbnail, renderThumbnail } from '../../features/thumbnail/renderer';
import {
  DEFAULT_THUMBNAIL_STYLE,
  THUMBNAIL_FONTS,
  THUMBNAIL_LAYOUTS,
  THUMBNAIL_MODELS,
} from '../../features/thumbnail/templates';
import type {
  ThumbnailAsset,
  ThumbnailGenerationSettings,
  ThumbnailRenderSettings,
  ThumbnailTextSettings,
} from '../../features/thumbnail/types';

const DEFAULT_TEXT: ThumbnailTextSettings = {
  text: 'НОВАЯ\nИМБА?\nРАФААМ\nВЕРНУЛСЯ!',
  fontFamily: THUMBNAIL_FONTS[0].value,
  fontSize: 176,
  primaryColor: '#ffffff',
  accentColor: '#ffe500',
  accentLines: 2,
  strokeWidth: 22,
  shadowBlur: 24,
  lineHeight: 0.88,
};

const DEFAULT_GENERATION: ThumbnailGenerationSettings = {
  model: THUMBNAIL_MODELS[0].id,
  imageSize: '2K',
  batchSize: 2,
  layout: 'text-left',
  stylePrompt: DEFAULT_THUMBNAIL_STYLE,
};

function readUpload(file: File): Promise<ThumbnailAsset> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Можно загружать только изображения'));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => resolve({
      id: `upload:${crypto.randomUUID()}`,
      name: file.name,
      imageUrl: String(reader.result),
      source: 'upload',
    });
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export const ThumbnailTab: React.FC = () => {
  const chatGpt = useChatGpt();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const generationAbort = useRef<AbortController | null>(null);
  useEffect(() => () => generationAbort.current?.abort(), []);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [generation, setGeneration] = useState(DEFAULT_GENERATION);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [darken, setDarken] = useState(0.78);
  const [frameEnabled, setFrameEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ThumbnailAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<ThumbnailAsset[]>([]);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [selectedBackground, setSelectedBackground] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const backgroundUrl = backgrounds[selectedBackground] || selectedAssets[0]?.imageUrl || '';
  const renderSettings = useMemo<ThumbnailRenderSettings>(() => ({
    layout: generation.layout,
    text,
    darken,
    frameEnabled,
  }), [generation.layout, text, darken, frameEnabled]);

  useEffect(() => {
    if (!backgroundUrl || !canvasRef.current) return;
    let active = true;
    renderThumbnail(canvasRef.current, backgroundUrl, renderSettings, 1280, 720).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Ошибка предпросмотра');
    });
    return () => { active = false; };
  }, [backgroundUrl, renderSettings]);

  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setIsSearching(true);
    setError(null);
    try {
      setSearchResults(await searchHearthstoneAssets(query));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Поиск не удался');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleAsset = (asset: ThumbnailAsset) => {
    setSelectedAssets((current) => {
      if (current.some((item) => item.id === asset.id)) return current.filter((item) => item.id !== asset.id);
      if (current.length >= 4) {
        setError('Gemini принимает до четырёх персонажей в этом режиме');
        return current;
      }
      setError(null);
      return [...current, asset];
    });
    setBackgrounds([]);
    setSelectedBackground(0);
  };

  const handleUploads = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const room = Math.max(0, 4 - selectedAssets.length);
      const uploaded = await Promise.all(Array.from(files).slice(0, room).map(readUpload));
      setSelectedAssets((current) => [...current, ...uploaded].slice(0, 4));
      setBackgrounds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка загрузки');
    }
  };

  const handleModelChange = (model: string) => {
    const oneKOnly = model === 'gemini-3.1-flash-lite-image' || model === 'gemini-2.5-flash-image';
    setGeneration((current) => ({ ...current, model, imageSize: oneKOnly ? '1K' : current.imageSize }));
  };

  const generate = async () => {
    if (isGenerating) return;
    if (!selectedAssets.length) {
      setError('Сначала выберите или загрузите хотя бы один арт');
      return;
    }
    setIsGenerating(true);
    const controller = new AbortController();
    generationAbort.current = controller;
    setError(null);
    setProgress({ done: 0, total: generation.batchSize });
    try {
      const results = await generateHearthstoneThumbnailBackgrounds(
        selectedAssets,
        generation,
        (done, total) => setProgress({ done, total }),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setBackgrounds(results);
      setSelectedBackground(0);
    } catch (cause) {
      setError(controller.signal.aborted ? 'Ожидание остановлено. Следующие варианты не отправлены; уже принятый запрос может завершиться в ChatGPT.' : cause instanceof Error ? cause.message : 'Генерация не удалась');
    } finally {
      setIsGenerating(false);
    }
  };

  const download = async () => {
    if (!backgroundUrl) return;
    try {
      const dataUrl = await exportThumbnail(backgroundUrl, renderSettings);
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = `hs-thumbnail-${Date.now()}.png`;
      anchor.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось экспортировать PNG');
    }
  };

  return (
    <div className="studio-thumbnail space-y-8 pb-20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Выбранная модель создаёт арт без букв, а редактор накладывает точный русский заголовок и рамку.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isGenerating && generation.model === 'gpt-image-2' && <button type="button" className="studio-button" onClick={() => generationAbort.current?.abort()}>Остановить GPT</button>}
          <button
            type="button"
            onClick={generate}
            disabled={isGenerating || selectedAssets.length === 0 || generation.model === 'gpt-image-2' && !chatGpt.connected}
            className="studio-button studio-button--primary"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? `${progress.done}/${progress.total}` : 'Создать фон'}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!backgroundUrl}
            className="studio-button"
          >
            <Download className="h-4 w-4" />
            PNG 1920×1080
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm font-medium text-red-300">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">
          <section className="studio-thumbnail__model-section">
            <ModelPicker options={thumbnailModelOptions} value={generation.model} onChange={handleModelChange} disabled={isGenerating} />
            {generation.model === 'gpt-image-2' && <ChatGptImageNotice />}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Разрешение
                <select
                  value={generation.model === 'gpt-image-2' ? 'auto' : generation.imageSize}
                  disabled={generation.model === 'gpt-image-2' || generation.model.includes('lite') || generation.model.includes('2.5')}
                  onChange={(event) => setGeneration((current) => ({ ...current, imageSize: event.target.value as ThumbnailGenerationSettings['imageSize'] }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-white outline-none disabled:opacity-50"
                >
                  {generation.model === 'gpt-image-2' && <option value="auto">Автоматически</option>}
                  <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Варианты
                <select
                  value={generation.batchSize}
                  onChange={(event) => setGeneration((current) => ({ ...current, batchSize: Number(event.target.value) as ThumbnailGenerationSettings['batchSize'] }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                </select>
              </label>
            </div>
          </section>

          <section className="studio-thumbnail__surface">
            <div className="studio-thumbnail__section-title">
              <Palette className="h-4 w-4 text-fuchsia-400" /> Композиция
            </div>
            <div className="grid grid-cols-3 gap-2">
              {THUMBNAIL_LAYOUTS.map((layout) => (
                <button
                  type="button"
                  key={layout.id}
                  onClick={() => setGeneration((current) => ({ ...current, layout: layout.id }))}
                  title={layout.description}
                  aria-pressed={generation.layout === layout.id}
                  className="studio-thumbnail__layout-option"
                >{layout.name}</button>
              ))}
            </div>
            <textarea
              value={generation.stylePrompt}
              onChange={(event) => setGeneration((current) => ({ ...current, stylePrompt: event.target.value }))}
              rows={4}
              className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-zinc-950/70 p-3 text-xs leading-relaxed text-zinc-300 outline-none focus:border-violet-500/40"
              aria-label="Описание визуального стиля"
            />
          </section>

          <section className="studio-thumbnail__surface">
            <div className="mb-4 flex items-center justify-between">
              <div className="studio-thumbnail__section-title"><Gamepad2 className="h-4 w-4 text-emerald-400" /> Ассеты игры</div>
              <span className="text-[10px] font-bold text-zinc-500">{selectedAssets.length}/4</span>
            </div>
            <form onSubmit={runSearch} className="flex gap-2">
              <input
                aria-label="Поиск игровых ассетов"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название карты или героя"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-500/40"
              />
              <button type="submit" className="studio-button studio-button--primary" aria-label="Найти ассеты">
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </button>
            </form>
            {searchResults.length ? (
              <div className="mt-4 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
                {searchResults.map((asset) => {
                  const selected = selectedAssets.some((item) => item.id === asset.id);
                  return (
                    <button
                      type="button"
                      key={asset.id}
                      onClick={() => toggleAsset(asset)}
                      className={`group relative overflow-hidden rounded-xl border ${selected ? 'border-emerald-400' : 'border-white/5'}`}
                      title={asset.name}
                    >
                      <img src={asset.imageUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-zinc-950/85 px-1.5 py-1 text-[9px] font-bold text-white">{asset.name}</span>
                      {selected ? <span className="absolute right-1 top-1 rounded-full bg-emerald-400 p-1 text-black"><Check className="h-3 w-3" /></span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="studio-button mt-4 w-full"
            >
              <Upload className="h-4 w-4" /> Загрузить свои арты
            </button>
            <input ref={uploadRef} type="file" accept="image/*" multiple className="hidden" aria-label="Загрузить свои игровые арты" onChange={(event) => handleUploads(event.target.files)} />
            {selectedAssets.length ? (
              <div className="mt-4 space-y-2">
                {selectedAssets.map((asset, index) => (
                  <div key={asset.id} className="studio-thumbnail__asset-row flex items-center gap-3 p-2">
                    <img src={asset.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" referrerPolicy="no-referrer" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">{asset.name}</p>
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600">{index === 0 ? 'Главный герой' : `Ассет ${index + 1}`}</p>
                    </div>
                    <button type="button" onClick={() => toggleAsset(asset)} className="p-2 text-zinc-600 hover:text-red-400" aria-label={`Удалить ${asset.name}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="studio-thumbnail__preview-surface">
            <div className="studio-thumbnail__preview-canvas relative aspect-video overflow-hidden">
              <canvas ref={canvasRef} className={`h-full w-full ${backgroundUrl ? 'opacity-100' : 'opacity-0'}`} />
              {!backgroundUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                  <ImagePlus className="h-7 w-7 text-zinc-600" aria-hidden="true" />
                  <div><p className="font-black text-zinc-300">Выберите игровой арт</p><p className="mt-1 text-xs text-zinc-600">Он сразу появится в предпросмотре</p></div>
                </div>
              ) : null}
            </div>
          </section>

          {backgrounds.length > 1 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {backgrounds.map((url, index) => (
                <button type="button" key={url.slice(-48)} onClick={() => setSelectedBackground(index)} className={`overflow-hidden rounded-2xl border-2 ${selectedBackground === index ? 'border-violet-400' : 'border-transparent'}`}>
                  <img src={url} alt={`Вариант ${index + 1}`} className="aspect-video w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}

          <section className="studio-thumbnail__surface grid gap-5 lg:grid-cols-2">
            <div>
              <div className="studio-thumbnail__section-title"><Type className="h-4 w-4 text-yellow-300" /> Точный заголовок</div>
              <textarea
                aria-label="Точный заголовок обложки"
                value={text.text}
                onChange={(event) => setText((current) => ({ ...current, text: event.target.value }))}
                rows={5}
                className="w-full resize-none rounded-2xl border border-white/10 bg-zinc-950/70 p-4 text-lg font-black uppercase leading-tight text-white outline-none focus:border-yellow-400/40"
                placeholder="Каждая строка — отдельная строка обложки"
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Шрифт
                  <select value={text.fontFamily} onChange={(event) => setText((current) => ({ ...current, fontFamily: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-xs normal-case text-white outline-none">
                    {THUMBNAIL_FONTS.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Акцентных строк
                  <select value={text.accentLines} onChange={(event) => setText((current) => ({ ...current, accentLines: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-xs text-white outline-none">
                    {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="studio-thumbnail__section-title"><Frame className="h-4 w-4 text-amber-400" /> Оформление</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="rounded-xl border border-white/5 bg-zinc-950/60 p-3 text-[10px] font-black uppercase tracking-wider text-zinc-500">Основной цвет
                  <input type="color" value={text.primaryColor} onChange={(event) => setText((current) => ({ ...current, primaryColor: event.target.value }))} className="mt-2 h-9 w-full cursor-pointer rounded-lg bg-transparent" />
                </label>
                <label className="rounded-xl border border-white/5 bg-zinc-950/60 p-3 text-[10px] font-black uppercase tracking-wider text-zinc-500">Акцент
                  <input type="color" value={text.accentColor} onChange={(event) => setText((current) => ({ ...current, accentColor: event.target.value }))} className="mt-2 h-9 w-full cursor-pointer rounded-lg bg-transparent" />
                </label>
              </div>
              {[
                { label: 'Размер текста', value: text.fontSize, min: 80, max: 240, onChange: (value: number) => setText((current) => ({ ...current, fontSize: value })) },
                { label: 'Обводка', value: text.strokeWidth, min: 4, max: 36, onChange: (value: number) => setText((current) => ({ ...current, strokeWidth: value })) },
                { label: 'Затемнение под текстом', value: Math.round(darken * 100), min: 0, max: 92, onChange: (value: number) => setDarken(value / 100) },
              ].map((control) => (
                <label key={control.label} className="block text-[10px] font-black uppercase tracking-wider text-zinc-500">
                  <span className="flex justify-between"><span>{control.label}</span><span className="text-zinc-300">{control.value}</span></span>
                  <input type="range" min={control.min} max={control.max} value={control.value} onChange={(event) => control.onChange(Number(event.target.value))} className="mt-2 w-full accent-violet-500" />
                </label>
              ))}
              <button
                type="button"
                onClick={() => setFrameEnabled((value) => !value)}
                aria-pressed={frameEnabled}
                className="studio-thumbnail__frame-toggle"
              >
                Деревянная рамка
                <span className={`h-5 w-9 rounded-full p-0.5 ${frameEnabled ? 'bg-amber-400' : 'bg-zinc-700'}`}><span className={`block h-4 w-4 rounded-full bg-zinc-950 transition ${frameEnabled ? 'translate-x-4' : ''}`} /></span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
