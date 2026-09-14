import React, { useRef, useState } from 'react';
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
import {
  DEFAULT_THUMBNAIL_STYLE,
  THUMBNAIL_LAYOUTS,
  THUMBNAIL_MODELS,
} from '../../features/thumbnail/templates';
import type {
  ThumbnailAsset,
  GeneratedThumbnailBackground,
  ThumbnailGenerationSettings,
  ThumbnailTextSettings,
} from '../../features/thumbnail/types';

const DEFAULT_TEXT: ThumbnailTextSettings = {
  text: 'НОВАЯ\nИМБА?\nРАФААМ\nВЕРНУЛСЯ!',
  typographyPrompt: '',
  fontFamily: 'Thumbnail Condensed, sans-serif',
  treatment: 'auto',
  fontSize: 260,
  primaryColor: '#ffffff',
  accentColor: '#65e637',
  accentLines: 1,
  strokeWidth: 14,
  shadowBlur: 12,
  lineHeight: 0.82,
};

const DEFAULT_GENERATION: ThumbnailGenerationSettings = {
  model: THUMBNAIL_MODELS[0].id,
  imageSize: '2K',
  batchSize: 2,
  layout: 'auto',
  stylePrompt: DEFAULT_THUMBNAIL_STYLE,
};

function normalizedText(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
}

function readUpload(file: File): Promise<ThumbnailAsset> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Поддерживаются JPG, PNG и WebP'));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      reject(new Error('Размер одного изображения не должен превышать 25 МБ'));
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
  const uploadRef = useRef<HTMLInputElement>(null);
  const [generation, setGeneration] = useState(DEFAULT_GENERATION);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [frameEnabled, setFrameEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ThumbnailAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<ThumbnailAsset[]>([]);
  const [backgrounds, setBackgrounds] = useState<GeneratedThumbnailBackground[]>([]);
  const [selectedBackground, setSelectedBackground] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'assets' | 'art' | 'text'>('assets');

  const selectedGenerated = backgrounds[selectedBackground];
  const selectedScore = selectedGenerated?.ctrScore;
  const backgroundUrl = selectedGenerated?.imageUrl || selectedAssets[0]?.imageUrl || '';
  const generatedTextStale = Boolean(
    selectedGenerated?.textRenderedByAi
    && normalizedText(selectedGenerated.sourceHeadline) !== normalizedText(text.text),
  );

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
    const alreadySelected = selectedAssets.some((item) => item.id === asset.id);
    if (!alreadySelected && selectedAssets.length >= 4) {
      setError('Можно использовать до четырёх персонажей в одном варианте');
      return;
    }
    setError(null);
    setSelectedAssets(alreadySelected
      ? selectedAssets.filter((item) => item.id !== asset.id)
      : [...selectedAssets, asset]);
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
    if (!selectedAssets.length) {
      setError('Сначала выберите или загрузите хотя бы один арт');
      return;
    }
    if (!text.text.trim()) {
      setError('Введите заголовок обложки');
      setActivePanel('text');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setProgress({ done: 0, total: generation.batchSize });
    try {
      const results = await generateHearthstoneThumbnailBackgrounds(
        selectedAssets,
        generation,
        text,
        { frameEnabled },
        (done, total) => setProgress({ done, total }),
      );
      setBackgrounds(results);
      setSelectedBackground(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Генерация не удалась');
    } finally {
      setIsGenerating(false);
    }
  };

  const download = async () => {
    if (!selectedGenerated?.imageUrl) return;
    try {
      const anchor = document.createElement('a');
      anchor.href = selectedGenerated.imageUrl;
      anchor.download = `hs-thumbnail-${Date.now()}.${selectedGenerated.imageUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`;
      anchor.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось экспортировать PNG');
    }
  };

  const activeModel = THUMBNAIL_MODELS.find((model) => model.id === generation.model);
  const usesOpenRouter = activeModel?.provider === 'openrouter';

  return (
    <div className="pb-16">
      <header className="mb-6 flex flex-col gap-5 border-b border-line pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
            <Gamepad2 className="h-4 w-4" /> YouTube thumbnail studio
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight text-white sm:text-5xl">HS-обложка</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Соберите персонажей, задайте подачу и получите готовую кликабельную обложку с проверенным заголовком.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-medium text-zinc-400">
            <span className="rounded-full border border-line bg-panel px-3 py-1.5">{selectedAssets.length || 0}/4 ассета</span>
            <span className="rounded-full border border-line bg-panel px-3 py-1.5">{activeModel?.name}</span>
            <span className="rounded-full border border-line bg-panel px-3 py-1.5">{usesOpenRouter ? 'High · авто' : generation.imageSize} · {generation.batchSize} вар.</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <button
            type="button"
            onClick={download}
            disabled={!selectedGenerated || generatedTextStale}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong bg-panel-raised px-5 text-sm font-semibold text-white transition-colors hover:bg-panel-soft disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none"
          >
            <Download className="h-4 w-4" /> Скачать
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={isGenerating || selectedAssets.length === 0}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-950/20 transition-colors hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? `${progress.done}/${progress.total}` : 'Создать обложку'}
          </button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="mb-5 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">{error}</div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[370px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/20 xl:sticky xl:top-8">
          <div className="border-b border-line p-2" role="tablist" aria-label="Этапы создания обложки">
            <div className="grid grid-cols-3 gap-1">
              {([
                ['assets', '1', 'Ассеты', Gamepad2],
                ['art', '2', 'Арт', Palette],
                ['text', '3', 'Текст', Type],
              ] as const).map(([id, step, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === id}
                  onClick={() => setActivePanel(id)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-semibold transition-colors ${activePanel === id ? 'bg-accent-soft text-accent-bright' : 'text-zinc-500 hover:bg-panel-raised hover:text-zinc-200'}`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] ${activePanel === id ? 'bg-accent text-zinc-950' : 'bg-panel-soft text-zinc-500'}`}>{step}</span>
                  <Icon className="hidden h-3.5 w-3.5 sm:block xl:hidden 2xl:block" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[calc(100vh-180px)] overflow-y-auto p-4 sm:p-5">
            {activePanel === 'assets' ? (
              <div role="tabpanel">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-white">Персонажи и карты</h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">Первый выбранный арт станет главным героем.</p>
                </div>
                <form onSubmit={runSearch} className="flex gap-2">
                  <input
                    aria-label="Поиск игровых ассетов"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Рено, Рафаам, мурлок..."
                    className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-300/40"
                  />
                  <button type="submit" className="rounded-xl bg-accent p-3 text-zinc-950 transition-colors hover:bg-accent-bright" aria-label="Найти ассеты">
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </button>
                </form>
                {searchResults.length ? (
                  <div className="mt-4 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
                    {searchResults.map((asset) => {
                      const selected = selectedAssets.some((item) => item.id === asset.id);
                      return (
                        <button
                          type="button"
                          key={asset.id}
                          onClick={() => toggleAsset(asset)}
                          aria-pressed={selected}
                          className={`group relative overflow-hidden rounded-xl border transition ${selected ? 'border-accent ring-2 ring-amber-300/15' : 'border-line hover:border-line-strong'}`}
                          title={asset.name}
                        >
                          <img src={asset.imageUrl} alt={asset.name} className="aspect-square w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                          <span className="absolute inset-x-0 bottom-0 truncate bg-black/80 px-1.5 py-1.5 text-[9px] font-medium text-white backdrop-blur-sm">{asset.name}</span>
                          {selected ? <span className="absolute right-1.5 top-1.5 rounded-full bg-accent p-1 text-zinc-950"><Check className="h-3 w-3" /></span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-zinc-600">Введите имя карты или героя</div>
                )}
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel-raised px-4 py-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-line-strong hover:text-white"
                >
                  <Upload className="h-4 w-4" /> Загрузить свои арты
                </button>
                <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Загрузить свои игровые арты" onChange={(event) => handleUploads(event.target.files)} />
                {selectedAssets.length ? (
                  <div className="mt-5 space-y-2 border-t border-line pt-4">
                    <div className="mb-3 flex items-center justify-between text-xs"><span className="font-semibold text-zinc-300">Выбрано</span><span className="text-zinc-600">{selectedAssets.length}/4</span></div>
                    {selectedAssets.map((asset, index) => (
                      <div key={asset.id} className="flex items-center gap-3 rounded-xl border border-line bg-canvas/70 p-2">
                        <img src={asset.imageUrl} alt="" className="h-11 w-11 rounded-lg object-cover" referrerPolicy="no-referrer" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-white">{asset.name}</p>
                          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{index === 0 ? 'Главный герой' : `Дополнение ${index}`}</p>
                        </div>
                        <button type="button" onClick={() => toggleAsset(asset)} className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-300" aria-label={`Удалить ${asset.name}`}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activePanel === 'art' ? (
              <div role="tabpanel">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-white">Подача и качество</h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">Выберите модель, композицию и настроение сцены.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {THUMBNAIL_MODELS.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      onClick={() => handleModelChange(model.id)}
                      aria-pressed={generation.model === model.id}
                      className={`min-h-24 rounded-xl border p-3 text-left transition-colors ${generation.model === model.id ? 'border-amber-300/35 bg-accent-soft' : 'border-line bg-canvas/60 hover:border-line-strong'}`}
                    >
                      <span className={`block text-[9px] font-semibold uppercase tracking-[0.14em] ${generation.model === model.id ? 'text-accent-bright' : 'text-zinc-600'}`}>{model.badge}</span>
                      <span className="mt-2 block text-xs font-semibold text-white">{model.name.replace('Gemini ', '')}</span>
                      <span className="mt-1 block text-[10px] leading-snug text-zinc-500">{model.description}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {usesOpenRouter ? (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Качество
                      <div className="mt-2 rounded-xl border border-line bg-canvas px-3 py-2.5 text-xs normal-case text-white">High · авто</div>
                    </div>
                  ) : (
                    <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Разрешение
                      <select value={generation.imageSize} disabled={generation.model.includes('lite') || generation.model.includes('2.5')} onChange={(event) => setGeneration((current) => ({ ...current, imageSize: event.target.value as ThumbnailGenerationSettings['imageSize'] }))} className="mt-2 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-xs text-white disabled:opacity-40">
                        <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
                      </select>
                    </label>
                  )}
                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Варианты
                    <select value={generation.batchSize} onChange={(event) => setGeneration((current) => ({ ...current, batchSize: Number(event.target.value) as ThumbnailGenerationSettings['batchSize'] }))} className="mt-2 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-xs text-white">
                      <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                    </select>
                  </label>
                </div>
                <div className="mt-5 border-t border-line pt-5">
                  <p className="mb-3 text-xs font-semibold text-zinc-300">Зона заголовка</p>
                  <div className="grid grid-cols-2 gap-2">
                    {THUMBNAIL_LAYOUTS.map((layout) => (
                      <button type="button" key={layout.id} onClick={() => setGeneration((current) => ({ ...current, layout: layout.id }))} title={layout.description} aria-pressed={generation.layout === layout.id} className={`rounded-xl border px-2 py-3 text-[11px] font-semibold transition-colors ${generation.layout === layout.id ? 'border-amber-300/35 bg-accent-soft text-accent-bright' : 'border-line bg-canvas/60 text-zinc-500 hover:text-white'}`}>{layout.name}</button>
                    ))}
                  </div>
                  <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Арт-дирекшн
                    <textarea value={generation.stylePrompt} onChange={(event) => setGeneration((current) => ({ ...current, stylePrompt: event.target.value }))} rows={6} className="mt-2 w-full resize-none rounded-xl border border-line bg-canvas p-3 text-xs leading-relaxed text-zinc-300 focus:border-amber-300/35" aria-label="Описание визуального стиля" />
                  </label>
                </div>
              </div>
            ) : null}

            {activePanel === 'text' ? (
              <div role="tabpanel">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-white">AI-заголовок</h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">Модель сама рисует текст внутри арта. Canvas, готовые шрифты и повторные слои больше не используются.</p>
                </div>
                <div className="rounded-xl border border-emerald-300/15 bg-emerald-500/8 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200"><Sparkles className="h-4 w-4" /> Текст генерируется вместе с картинкой</div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-emerald-100/55">ИИ найдёт свободную область, выберет 2–4 смысловые строки, цвет и объём. Заголовок разрешён только один раз.</p>
                </div>
                {generatedTextStale ? <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] font-medium text-amber-200">Текст изменён — создайте обложку заново.</p> : null}
                <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Точный заголовок
                  <textarea aria-label="Точный заголовок обложки" value={text.text} onChange={(event) => setText((current) => ({ ...current, text: event.target.value }))} rows={5} maxLength={120} className="mt-2 w-full resize-none rounded-xl border border-line bg-canvas p-4 font-display text-xl font-black uppercase leading-[0.95] text-white focus:border-amber-300/35" placeholder="Например: НОВАЯ ИМБА? ЖРЕЦ НА ПОДГОТОВКЕ" />
                </label>
                <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">Переносы можно не задавать: модель сама соберёт компактный смысловой блок и выделит ключевую фразу.</p>
                <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Пожелание к типографике <span className="normal-case tracking-normal text-zinc-700">· необязательно</span>
                  <textarea aria-label="Пожелание к типографике" value={text.typographyPrompt} onChange={(event) => setText((current) => ({ ...current, typographyPrompt: event.target.value }))} rows={4} maxLength={400} className="mt-2 w-full resize-none rounded-xl border border-line bg-canvas p-3 text-xs leading-relaxed text-zinc-300 focus:border-amber-300/35" placeholder="Например: главный акцент — кислотно-зелёный, больше драматичного объёма" />
                </label>
                <div className="mt-5 space-y-4 border-t border-line pt-5">
                  <button type="button" onClick={() => setFrameEnabled((value) => !value)} aria-pressed={frameEnabled} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-xs font-semibold transition-colors ${frameEnabled ? 'border-amber-300/25 bg-accent-soft text-accent-bright' : 'border-line text-zinc-500'}`}>
                    <span className="flex items-center gap-2"><Frame className="h-4 w-4" /> Рамка внутри AI-арта</span>
                    <span className={`h-5 w-9 rounded-full p-0.5 ${frameEnabled ? 'bg-accent' : 'bg-zinc-700'}`}><span className={`block h-4 w-4 rounded-full bg-zinc-950 transition ${frameEnabled ? 'translate-x-4' : ''}`} /></span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 space-y-4 xl:sticky xl:top-8">
          <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/25">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Предпросмотр</h2>
                <p className="mt-0.5 text-[10px] text-zinc-600">Финальный кадр 16:9 · экспорт без потери качества</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedGenerated?.textRenderedByAi ? <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${selectedGenerated.textVerified ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-300/20 bg-amber-500/10 text-amber-200'}`}>{selectedGenerated.textVerified ? 'Текст проверен' : 'Проверьте текст'}</span> : null}
                {selectedScore ? <span className="rounded-full border border-amber-300/20 bg-accent-soft px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-accent-bright">CTR {selectedScore.overall}</span> : null}
              </div>
            </div>
            <div className="p-2 sm:p-3">
              <div className="relative aspect-video overflow-hidden rounded-xl bg-[radial-gradient(circle_at_70%_30%,#30243d,#17121d_55%,#09090a)]">
                {backgroundUrl ? <img src={backgroundUrl} alt="Предпросмотр готовой AI-обложки" className="h-full w-full object-cover" /> : null}
                {!backgroundUrl ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                    <div className="rounded-2xl border border-line bg-panel/80 p-4"><ImagePlus className="h-8 w-8 text-zinc-600" /></div>
                    <div><p className="text-sm font-semibold text-zinc-300">Начните с игрового арта</p><p className="mt-1 text-xs text-zinc-600">Выберите героя слева — он появится здесь</p></div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2 text-[10px] text-zinc-500"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Автосохранение настроек в текущей сессии</div>
              <span className="text-[10px] font-medium text-zinc-500">AI-арт + AI-типографика · без Canvas</span>
            </div>
          </section>

          {backgrounds.length > 1 ? (
            <section className="rounded-2xl border border-line bg-panel p-3">
              <div className="mb-3 flex items-center justify-between px-1"><h2 className="text-xs font-semibold text-zinc-300">Варианты</h2><span className="text-[10px] text-zinc-600">Лучший по CTR выбран автоматически</span></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {backgrounds.map((background, index) => (
                  <button type="button" key={background.imageUrl.slice(-48)} onClick={() => setSelectedBackground(index)} aria-pressed={selectedBackground === index} className={`relative overflow-hidden rounded-xl border-2 transition ${selectedBackground === index ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                    <img src={background.imageUrl} alt={`Вариант ${index + 1}`} className="aspect-video w-full object-cover" />
                    {background.ctrScore ? <span className="absolute right-1.5 top-1.5 rounded-full bg-black/80 px-2 py-1 text-[9px] font-semibold text-white">CTR {background.ctrScore.overall}</span> : null}
                    {index === 0 ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-accent px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-950">Лучший</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {selectedScore ? (
            <section className="grid gap-4 rounded-2xl border border-line bg-panel p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div>
                <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Проверка 320×180</p>
                <img src={selectedGenerated.imageUrl} alt="Миниатюра YouTube размером 320 на 180" className="aspect-video w-full max-w-80 rounded-lg object-cover shadow-xl ring-1 ring-line" />
              </div>
              <div className="min-w-0">
                <div className="grid grid-cols-5 gap-2">
                  {[
                    ['Текст', selectedScore.mobileReadability],
                    ['Герой', selectedScore.subjectImpact],
                    ['Контраст', selectedScore.contrast],
                    ['Интрига', selectedScore.curiosity],
                    ['Чистота', selectedScore.clutterControl],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-line bg-canvas/70 p-2 text-center">
                      <p className="text-base font-bold text-white">{value}</p>
                      <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-600">{label}</p>
                    </div>
                  ))}
                </div>
                {selectedScore.summary ? <p className="mt-3 text-xs leading-relaxed text-zinc-400">{selectedScore.summary}</p> : null}
                {selectedScore.issues.length ? <p className="mt-2 text-[10px] leading-relaxed text-amber-200/80">Следующий шаг: {selectedScore.issues.slice(0, 2).join(' • ')}</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};
