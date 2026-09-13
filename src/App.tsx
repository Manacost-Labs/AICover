/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, Suspense } from 'react';
import {
  Sparkles,
  X,
  ImageIcon,
  Layout,
  Plus,
  Maximize2,
  Loader2,
  ChevronRight,
  Settings,
  BookOpen,
  Images,
  Film,
  Paintbrush,
  Moon,
  Sun,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WorkspaceNavigation, workspaceTabs, type AppTab } from './components/layout/WorkspaceNavigation';
import { Button } from './components/ui/Controls';
import { ProviderModelPicker as ModelPicker, ChatGptImageNotice, OpenRouterImageNotice, useChatGpt } from './components/ui/ChatGptConnection';
import { generationModelOptions } from './features/models/options';
import { useImageTools } from './features/image-tools/useImageTools';
import { get, set } from 'idb-keyval';
import type {
  CoverGenerationProgress,
  ImageSource,
  GenerationSettings,
  SceneRole,
} from './services/generationContracts';
import {
  DEFAULT_SYSTEM_PROMPT_CREATE,
  DEFAULT_SYSTEM_PROMPT_EDIT,
  sceneRolesOrder,
} from './services/generationContracts';
import {
  loadGenerationService,
  loadGenerationServiceForRun,
} from './services/generationServiceLoader';
import {
  loadCardLibrary, saveCardToLibrary, deleteCardFromLibrary,
  loadReferenceLibrary, saveReferenceToLibrary, deleteReferenceFromLibrary, updateReferenceVisionAnalysis, fetchUrlAsImageSource,
  loadHistory, saveToHistory,
  loadFavorites, addToFavorites, removeFromFavorites,
  updateFavoriteChoiceAnalysis,
  loadFavoriteChoiceNotesMap,
  imageUrlToImageSource,
  type CardLibraryEntry,
  type ReferenceLibraryEntry,
} from './services/serverStorageService';
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  normalizeGeminiImageSettings,
  supportsGeminiAspectRatio,
  supportsGeminiImageSize,
} from './constants';
import { getOpenRouterModel, isOpenRouterImageModel, normalizeOpenRouterSettings } from './services/openRouterImages';
import { ImageLightbox } from './components/ImageLightbox';

const CreateTab = React.lazy(() =>
  import('./components/tabs/CreateTab').then((m) => ({ default: m.CreateTab }))
);
const ImageToolsTab = React.lazy(() =>
  import('./components/tabs/ImageToolsTab').then((m) => ({ default: m.ImageToolsTab }))
);
const HistoryTab = React.lazy(() =>
  import('./components/tabs/HistoryTab').then((m) => ({ default: m.HistoryTab }))
);
const FavoritesTab = React.lazy(() =>
  import('./components/tabs/FavoritesTab').then((m) => ({ default: m.FavoritesTab }))
);
const ReferencesTab = React.lazy(() =>
  import('./components/tabs/ReferencesTab').then((m) => ({ default: m.ReferencesTab }))
);

const ThumbnailTab = React.lazy(() =>
  import('./components/tabs/ThumbnailTab').then((m) => ({ default: m.ThumbnailTab }))
);

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'cover_theme';

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
  } catch {
    // Privacy modes can deny storage; theme selection still works for this session.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const ErrorBoundary: any = class extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if ((this as any).state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
          {/* Background Elements */}
          <div className="absolute inset-0 z-0">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
          </div>

          <div className="relative z-10">
            <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-red-500/20 shadow-sm">
              <Sparkles className="w-10 h-10 text-red-500" />
            </div>
            <h1 className="text-2xl font-black tracking-tighter mb-4 uppercase">Что-то пошло не так</h1>
            <p className="text-zinc-500 max-w-md mb-8 text-sm font-medium">
              {(this as any).state.error?.message || "Произошла непредвиденная ошибка."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-4 bg-white text-zinc-950 font-black rounded-2xl hover:bg-zinc-100 transition-all hover:scale-105 active:scale-95 shadow-xl uppercase tracking-widest text-xs"
            >
              Перезагрузить приложение
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

interface UISource extends ImageSource {
  id: string;
  role?: SceneRole;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function AppContent() {
  const chatGpt = useChatGpt();
  const [activeTab, setActiveTab] = useState<AppTab>('create');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [thumbnailVisited, setThumbnailVisited] = useState(false);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [sources, setSources] = useState<UISource[]>([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Keep the in-memory selection when persistent storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (activeTab === 'thumbnail') setThumbnailVisited(true);
  }, [activeTab]);
  const [createLayoutMode, setCreateLayoutMode] = useState<'cover' | 'scene'>('cover');
  const [scenePlan, setScenePlan] = useState<2 | 3>(3);
  const [focusedSceneSlot, setFocusedSceneSlot] = useState<SceneRole>('left');
  const createLayoutModeRef = useRef<'cover' | 'scene'>('cover');
  const scenePlanRef = useRef<2 | 3>(3);
  const focusedSceneSlotRef = useRef<SceneRole>('left');
  const pendingSourceSlotRef = useRef<SceneRole | null>(null);
  createLayoutModeRef.current = createLayoutMode;
  scenePlanRef.current = scenePlan;
  focusedSceneSlotRef.current = focusedSceneSlot;
  const sourcesRef = useRef<UISource[]>([]);
  
  const [likedImages, setLikedImages] = useState<string[]>([]);
  /** URL → JSON/text from Gemini: why this favorite vs batch siblings */
  const [favoriteChoiceNotes, setFavoriteChoiceNotes] = useState<Record<string, string>>({});
  const [favoriteAnalysisLoadingUrl, setFavoriteAnalysisLoadingUrl] = useState<string | null>(null);
  // Memoized values for performance
  const likedSet = React.useMemo(() => new Set(likedImages), [likedImages]);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  const [reference, setReference] = useState<ImageSource | null>(null);
  /** Saved Gemini vision JSON/text when reference was picked from reference library */
  const [referenceVisionNotes, setReferenceVisionNotes] = useState<string | null>(null);
  const [baseImage, setBaseImage] = useState<ImageSource | null>(null);
  const [settings, setSettings] = useState<GenerationSettings>({
    model: "gemini-2.5-flash-image",
    aspectRatio: "16:9",
    imageSize: "1K",
    prompt: "",
    negativePrompt: "",
    batchSize: 1,
    strictMode: true
  });
  const [results, setResults] = useState<string[]>([]);

  const resultsRef = useRef<string[]>([]);
  const likedImagesRef = useRef<string[]>([]);
  const settingsRef = useRef(settings);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);
  useEffect(() => {
    likedImagesRef.current = likedImages;
  }, [likedImages]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const [history, setHistory] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [hasOpenRouter, setHasOpenRouter] = useState(false);
  const [checkingKey, setCheckingKey] = useState(true);
  const historyRef = useRef(history);
  historyRef.current = history;
  const externalUpscaleActive = useRef(false);
  const imageTools = useImageTools({
    available: hasKey && !checkingKey && !isUpscaling && !isGenerating,
    onSave: async (url) => {
      const next = [url, ...historyRef.current].slice(0, 50);
      historyRef.current = next;
      setHistory(next);
      // A local storage failure must not prevent the server save.
      try { await set('fusion_history', next); } catch { /* Server persistence is still attempted. */ }
      const saved = await saveToHistory(url);
      if (!saved) throw new Error('History save failed');
    },
  });
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const generationRunId = useRef(0);
  const generationAbort = useRef<AbortController | null>(null);
  const generationActive = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSettings || !settingsDialogRef.current) return;
    const dialog = settingsDialogRef.current as HTMLDivElement;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(element => !element.closest('[hidden]'));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setShowSettings(false); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    return () => { dialog.removeEventListener('keydown', trap); previousFocus?.focus(); };
  }, [showSettings]);
  const [settingsTab, setSettingsTab] = useState<'prompt' | 'settings' | 'preview'>('prompt');
  const [settingsPromptMode, setSettingsPromptMode] = useState<'create' | 'edit'>('create');
  const [generationProgress, setGenerationProgress] = useState<CoverGenerationProgress | null>(null);
  const [sceneToCoverWarning, setSceneToCoverWarning] = useState(false);
  const [cardLibrary, setCardLibrary] = useState<CardLibraryEntry[]>([]);
  const [referenceLibrary, setReferenceLibrary] = useState<ReferenceLibraryEntry[]>([]);
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isSavingReference, setIsSavingReference] = useState(false);
  const [reanalyzingReferenceId, setReanalyzingReferenceId] = useState<string | null>(null);

  // Lightbox gallery context — derive image list from current active tab
  const lightboxImages = React.useMemo(() => {
    if (!fullscreenImage) return [] as string[];
    if (activeTab === 'create') return results;
    if (activeTab === 'history') return history;
    if (activeTab === 'favorites') return likedImages;
    if (activeTab === 'references') return referenceLibrary.map((e) => e.storageUrl);
    return [fullscreenImage];
  }, [fullscreenImage, activeTab, results, history, likedImages, referenceLibrary]);

  const lightboxIndex = fullscreenImage ? lightboxImages.indexOf(fullscreenImage) : -1;

  const handleLightboxPrev = React.useCallback(() => {
    if (lightboxIndex > 0) setFullscreenImage(lightboxImages[lightboxIndex - 1]);
  }, [lightboxIndex, lightboxImages]);

  const handleLightboxNext = React.useCallback(() => {
    if (lightboxIndex < lightboxImages.length - 1) setFullscreenImage(lightboxImages[lightboxIndex + 1]);
  }, [lightboxIndex, lightboxImages]);

  useEffect(() => {
    const loadData = async () => {
      try {
        // ── Legacy localStorage → IDB migration ──────────────────────────
        const localHistory = localStorage.getItem('fusion_history');
        const localLiked = localStorage.getItem('fusion_liked');
        let idbHistory = await get('fusion_history');
        let idbLiked = await get('fusion_liked');
        if (localHistory && !idbHistory) {
          idbHistory = JSON.parse(localHistory);
          await set('fusion_history', idbHistory);
          localStorage.removeItem('fusion_history');
        }
        if (localLiked && !idbLiked) {
          idbLiked = JSON.parse(localLiked);
          await set('fusion_liked', idbLiked);
          localStorage.removeItem('fusion_liked');
        }

        // The Cover API persists the shared library and media in this service's MySQL database.
        const [serverHistory, serverLiked, serverLibrary, serverRefs] = await Promise.all([
          loadHistory(),
          loadFavorites(),
          loadCardLibrary(),
          loadReferenceLibrary(),
        ]);
        if (serverHistory.length) setHistory(serverHistory);
        else if (idbHistory) setHistory(idbHistory);
        if (serverLiked.length) setLikedImages(serverLiked);
        else if (idbLiked) setLikedImages(idbLiked);
        setCardLibrary(serverLibrary);
        setReferenceLibrary(serverRefs);
        try {
          const [idbFavNotes, serverFavNotes] = await Promise.all([
            get('fusion_favorite_choice_notes') as Promise<Record<string, string> | undefined>,
            loadFavoriteChoiceNotesMap(),
          ]);
          setFavoriteChoiceNotes({
            ...(idbFavNotes && typeof idbFavNotes === 'object' ? idbFavNotes : {}),
            ...serverFavNotes,
          });
        } catch {
          /* non-fatal */
        }
      } catch (e) {
        console.error("Failed to load data", e);
        // Fallback to IDB
        try {
          const idbHistory = await get('fusion_history');
          const idbLiked = await get('fusion_liked');
          if (idbHistory) setHistory(idbHistory);
          if (idbLiked) setLikedImages(idbLiked);
          try {
            const idbFavNotes = await get('fusion_favorite_choice_notes') as Record<string, string> | undefined;
            if (idbFavNotes && typeof idbFavNotes === 'object') setFavoriteChoiceNotes(idbFavNotes);
          } catch {
            /* non-fatal */
          }
        } catch {}
      }
    };
    loadData();
  }, []);

  const sourceInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const handleLocalPaste = (e: React.ClipboardEvent, type: 'source' | 'reference') => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          processFile(file, type);
          e.stopPropagation();
        }
      }
    }
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!fullscreenImage) return;
      if (e.key === 'ArrowLeft') handleLightboxPrev();
      else if (e.key === 'ArrowRight') handleLightboxNext();
      else if (e.key === 'Escape') setFullscreenImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenImage, handleLightboxPrev, handleLightboxNext]);

  useEffect(() => {
    checkKey();

    const handlePaste = (e: ClipboardEvent) => {
      // Only "Создать" uses global image paste; other tabs (e.g. Library art drop zone) must not fill sources/reference
      if (activeTabRef.current !== 'create') return;
      // Skip if target is an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLSelectElement) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const mode = createLayoutModeRef.current;
            if (mode === 'cover') {
              if (sourcesRef.current.length < 4) {
                processFile(file, 'source');
              } else {
                processFile(file, 'reference');
              }
            } else {
              const plan = scenePlanRef.current;
              const roles = sceneRolesOrder(plan);
              const prev = sourcesRef.current;
              const full = roles.every(r => prev.some(s => s.role === r));
              if (full) {
                processFile(file, 'source', focusedSceneSlotRef.current);
              } else {
                processFile(file, 'source');
              }
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const checkKey = async () => {
    setCheckingKey(true);
    try {
      if (window.aistudio) {
        // Running inside Google AI Studio — use its key management
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
        setHasOpenRouter(false);
      } else {
        // The production key is deliberately server-only. This endpoint returns
        // a capability flag, never a credential.
        const response = await fetch('/api/runtime-capabilities', { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Runtime capabilities unavailable: HTTP ${response.status}`);
        const capabilities = await response.json() as { gemini?: unknown; openrouter?: unknown };
        setHasKey(capabilities.gemini === true);
        setHasOpenRouter(capabilities.openrouter === true);
      }
    } catch (e) {
      setHasKey(false);
      setHasOpenRouter(false);
    } finally {
      setCheckingKey(false);
    }
  };

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      await checkKey();
    }
  };

  const processFile = (file: File, type: 'source' | 'reference', sourceSlot?: SceneRole) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (type === 'source') {
        if (createLayoutModeRef.current === 'cover') {
          setSources(prev => {
            if (prev.length < 4) {
              return [...prev, { id: Math.random().toString(36).substring(7), data: base64, mimeType: file.type }];
            }
            return prev;
          });
        } else {
          setSources(prev => {
            const plan = scenePlanRef.current;
            const roles = sceneRolesOrder(plan);
            let slot = sourceSlot;
            if (!slot || !roles.includes(slot)) {
              slot = roles.find(r => !prev.some(s => s.role === r)) ?? focusedSceneSlotRef.current;
            }
            if (!slot || !roles.includes(slot)) return prev;
            const newItem: UISource = {
              id: Math.random().toString(36).substring(7),
              data: base64,
              mimeType: file.type,
              role: slot,
            };
            return [...prev.filter(s => s.role !== slot), newItem];
          });
        }
      } else {
        setReference({ data: base64, mimeType: file.type });
        setReferenceVisionNotes(null);
      }
    };
    reader.onerror = () => {
      setError("Не удалось прочитать файл. Пожалуйста, попробуйте снова.");
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'source' | 'reference') => {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    if (type === 'reference') {
      if (files[0]) processFile(files[0], 'reference');
      return;
    }
    if (createLayoutMode === 'cover') {
      files.forEach(file => processFile(file, 'source'));
      return;
    }
    const pending = pendingSourceSlotRef.current;
    pendingSourceSlotRef.current = null;
    const plan = scenePlanRef.current;
    const roles = sceneRolesOrder(plan);
    try {
      const urls = await Promise.all(files.map(f => readFileAsDataURL(f)));
      setSources(prev => {
        let next = [...prev];
        const startIdx = pending && roles.includes(pending) ? roles.indexOf(pending) : -1;
        for (let i = 0; i < urls.length; i++) {
          let role: SceneRole | undefined;
          if (i === 0 && startIdx >= 0) role = roles[startIdx];
          else role = roles.find(r => !next.some(s => s.role === r)) ?? focusedSceneSlotRef.current;
          if (!role || !roles.includes(role)) break;
          const mime = files[i].type;
          const id = Math.random().toString(36).substring(7);
          next = [...next.filter(s => s.role !== role), { id, data: urls[i], mimeType: mime, role }];
        }
        return next;
      });
    } catch {
      setError("Не удалось прочитать файл. Пожалуйста, попробуйте снова.");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = (Array.from(e.dataTransfer.files) as File[]).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    if (createLayoutModeRef.current === 'scene' && files.length > 1) {
      try {
        const urls = await Promise.all(files.map(f => readFileAsDataURL(f)));
        const plan = scenePlanRef.current;
        const roles = sceneRolesOrder(plan);
        setSources(prev => {
          let next = [...prev];
          for (let i = 0; i < urls.length; i++) {
            const role = roles.find(r => !next.some(s => s.role === r)) ?? focusedSceneSlotRef.current;
            if (!role || !roles.includes(role)) break;
            const id = Math.random().toString(36).substring(7);
            next = [...next.filter(s => s.role !== role), { id, data: urls[i], mimeType: files[i].type, role }];
          }
          return next;
        });
      } catch {
        setError("Не удалось прочитать файл. Пожалуйста, попробуйте снова.");
      }
      return;
    }
    files.forEach(file => processFile(file, 'source'));
  };

  const handleDragOverRef = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingRef(true);
  };

  const handleDragLeaveRef = () => {
    setIsDraggingRef(false);
  };

  const handleDropRef = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingRef(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    if (files[0] && files[0].type.startsWith('image/')) {
      processFile(files[0], 'reference');
    }
  };

  const removeSource = (index: number) => {
    setSources(prev => prev.filter((_, i) => i !== index));
  };

  // Calls from Create / History / Favorites keep their existing destination.
  // The new page captures explicit operations instead of branching on activeTab.
  const handleUpscale = React.useCallback(async (url: string, existingId?: string) => {
    if (externalUpscaleActive.current) return;
    externalUpscaleActive.current = true;
    setIsUpscaling(true);
    setError(null);
    const requestSettings = { ...imageTools.settings };
    const input = { data: url, mimeType: /^data:([^;]+);/.exec(url)?.[1] ?? 'image/png' };
    try {
      const { upscaleImage } = await loadGenerationService();
      const upscaledUrl = await upscaleImage(input, requestSettings.imageSize, requestSettings.model);
      imageTools.addExternalResult({ id: existingId ?? crypto.randomUUID(), source: input, operation: 'upscale', settings: requestSettings, output: upscaledUrl, status: 'done' });
      if (activeTab === 'create') setResults(prev => [upscaledUrl, ...prev]);
      const newHistory = [upscaledUrl, ...historyRef.current].slice(0, 50);
      historyRef.current = newHistory;
      setHistory(newHistory);
      await set('fusion_history', newHistory);
      saveToHistory(upscaledUrl).catch(() => {});
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Ошибка при апскейле');
    } finally {
      externalUpscaleActive.current = false;
      setIsUpscaling(false);
    }
  }, [activeTab, imageTools.settings, imageTools.addExternalResult]);

  const handleGenerate = async () => {
    if (generationActive.current || isUpscaling) return;
    const providerUnavailable = settings.model === 'gpt-image-2'
      ? !chatGpt.connected || chatGpt.checking
      : isOpenRouterImageModel(settings.model)
        ? !hasOpenRouter || checkingKey
        : !hasKey || checkingKey;
    if (providerUnavailable) { setError('Генерация пока недоступна. Проверьте подключение выбранной модели.'); return; }
    const ordered =
      createLayoutMode === 'scene'
        ? sceneRolesOrder(scenePlan)
            .map(r => sources.find(s => s.role === r))
            .filter((x): x is UISource => x != null)
        : sources;
    if (createLayoutMode === 'scene') {
      if (ordered.length !== scenePlan) {
        setError('Заполните все слоты сцены для выбранного плана.');
        return;
      }
    } else if (ordered.length < 2) {
      setError("Пожалуйста, загрузите хотя бы 2 изображения.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    generationActive.current = true;
    const runId = ++generationRunId.current;
    const controller = new AbortController();
    generationAbort.current = controller;
    setSaveWarning(null);
    setGenerationNotice(null);
    setGenerationProgress({
      done: 0,
      total: settings.batchSize,
      phase: 'preparing',
    });
    const openRouterRun = isOpenRouterImageModel(settings.model);
    const historyBeforeRun = historyRef.current;
    const streamedImages: string[] = [];
    const publishOpenRouterResult = openRouterRun
      ? async (imageUrl: string) => {
          streamedImages.push(imageUrl);
          const visibleImages = [...streamedImages];
          const newHistory = [...visibleImages, ...historyBeforeRun].slice(0, 100);
          setResults(visibleImages);
          historyRef.current = newHistory;
          setHistory(newHistory);
          setGenerationNotice('Сохраняем готовый вариант в историю…');
          const [savedLocally, saved] = await Promise.all([
            set('fusion_history', newHistory).then(() => true).catch(() => false),
            saveToHistory(imageUrl).catch(() => null),
          ]);
          setGenerationNotice(null);
          if (!saved) {
            setSaveWarning('Не удалось сохранить результат в историю на сервере. Скачайте изображение, чтобы не потерять его.');
          }
          if (!savedLocally && !saved) {
            throw new Error('Готовый вариант показан, но не удалось надёжно сохранить его. Скачайте изображение.');
          }
        }
      : undefined;
    try {
      const service = await loadGenerationServiceForRun(
        controller.signal,
        () => generationRunId.current === runId,
      );
      if (!service) return;
      const { generateFusedCover } = service;
      const images = await generateFusedCover(
        ordered, reference, settings, baseImage, likedImages, referenceVisionNotes,
        (p) => { if (generationRunId.current === runId) setGenerationProgress(p); },
        controller.signal,
        publishOpenRouterResult,
      );

      if (generationRunId.current !== runId) return;

      if (!openRouterRun) {
        setGenerationProgress({
          done: images.length,
          total: settings.batchSize,
          phase: 'finalizing',
        });
        setResults(images);
        const newHistory = [...images, ...history].slice(0, 100);
        historyRef.current = newHistory;
        setHistory(newHistory);
        // A storage failure must never turn an already generated image into an error.
        void set('fusion_history', newHistory).catch(() => {});
        setGenerationNotice('Сохраняем результат в историю…');
        void Promise.all(images.map(img => saveToHistory(img).catch(() => null))).then(saved => {
          if (generationRunId.current !== runId) return;
          setGenerationNotice(null);
          if (saved.some(item => !item)) setSaveWarning('Не удалось сохранить результат в историю на сервере. Скачайте изображение, чтобы не потерять его.');
        });
      }
    } catch (err: any) {
      if (generationRunId.current !== runId) return;
      console.error(err);
      setError(err.message || "Генерация не удалась. Пожалуйста, попробуйте снова.");
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
      }
    } finally {
      if (generationRunId.current === runId) {
        generationActive.current = false;
        setIsGenerating(false);
        setGenerationProgress(null);
      }
    }
  };

  const handleCancelGeneration = () => {
    generationAbort.current?.abort();
    generationRunId.current += 1;
    generationActive.current = false;
    setIsGenerating(false);
    setGenerationProgress(null);
    setGenerationNotice('Ожидание остановлено. Уже отправленная операция может продолжиться на стороне сервиса.');
  };

  const runFavoriteChoiceAnalysis = React.useCallback(async (
    url: string,
    favoriteRowId: string | null,
    batchSnapshot?: string[]
  ) => {
    setFavoriteAnalysisLoadingUrl(url);
    try {
      const chosen = await imageUrlToImageSource(url);
      // Use snapshot passed at call-time to avoid stale-ref race condition
      const batch = batchSnapshot ?? resultsRef.current;
      const siblings = batch.filter(u => u !== url);
      const alternatives: ImageSource[] = [];
      for (const u of siblings.slice(0, 3)) {
        alternatives.push(await imageUrlToImageSource(u));
      }
      const { analyzeFavoriteChoiceVision } = await loadGenerationService();
      const text = await analyzeFavoriteChoiceVision(chosen, alternatives, {
        userPromptHint: settingsRef.current.prompt,
      });
      setFavoriteChoiceNotes(prev => ({ ...prev, [url]: text }));
      const existing = (await get('fusion_favorite_choice_notes')) as Record<string, string> | undefined;
      await set('fusion_favorite_choice_notes', {
        ...(existing && typeof existing === 'object' ? existing : {}),
        [url]: text,
      });
      if (favoriteRowId) {
        await updateFavoriteChoiceAnalysis(favoriteRowId, text);
      }
    } catch (e) {
      console.error('runFavoriteChoiceAnalysis', e);
    } finally {
      setFavoriteAnalysisLoadingUrl(null);
    }
  }, []);

  const toggleLike = React.useCallback(
    async (url: string) => {
      const isLiked = likedImagesRef.current.includes(url);
      if (isLiked) {
        const newLikes = likedImagesRef.current.filter(item => item !== url);
        setLikedImages(newLikes);
        likedImagesRef.current = newLikes;
        await set('fusion_liked', newLikes);
        setFavoriteChoiceNotes(prev => {
          const next = { ...prev };
          delete next[url];
          return next;
        });
        try {
          const idbNotes = (await get('fusion_favorite_choice_notes')) as Record<string, string> | undefined;
          if (idbNotes && typeof idbNotes === 'object' && idbNotes[url]) {
            delete idbNotes[url];
            await set('fusion_favorite_choice_notes', idbNotes);
          }
        } catch (e) {
          console.error(e);
        }
        removeFromFavorites(url).catch(() => {});
        return;
      }
      const newLikes = [...likedImagesRef.current, url];
      setLikedImages(newLikes);
      likedImagesRef.current = newLikes;
      await set('fusion_liked', newLikes);
      let favId: string | null = null;
      const res = await addToFavorites(url);
      favId = res?.id ?? null;
      void runFavoriteChoiceAnalysis(url, favId, resultsRef.current.slice());
    },
    [runFavoriteChoiceAnalysis]
  );

  const handleSaveCard = React.useCallback(async (name: string, cardId: string, imageData: string, mimeType: string) => {
    setIsSavingCard(true);
    try {
      const entry = await saveCardToLibrary(name, cardId, imageData, mimeType);
      setCardLibrary(prev => [entry, ...prev]);
    } finally {
      setIsSavingCard(false);
    }
  }, []);

  const handleDeleteCard = React.useCallback(async (id: string, storagePath: string) => {
    await deleteCardFromLibrary(id, storagePath);
    setCardLibrary(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleSaveReference = React.useCallback(async (name: string, imageData: string, mimeType: string) => {
    setIsSavingReference(true);
    try {
      const entry = await saveReferenceToLibrary(name, imageData, mimeType);
      setReferenceLibrary((prev) => [entry, ...prev]);
      try {
        const { analyzeReferenceCompositionVision } = await loadGenerationService();
        const analysis = await analyzeReferenceCompositionVision({ data: imageData, mimeType });
        await updateReferenceVisionAnalysis(entry.id, analysis);
        setReferenceLibrary((prev) =>
          prev.map((r) => (r.id === entry.id ? { ...r, visionAnalysis: analysis } : r))
        );
      } catch (e) {
        console.error('Reference vision analysis failed', e);
      }
    } finally {
      setIsSavingReference(false);
    }
  }, []);

  const handleReanalyzeReference = React.useCallback(async (entry: ReferenceLibraryEntry) => {
    setReanalyzingReferenceId(entry.id);
    try {
      const { data, mimeType } = await fetchUrlAsImageSource(entry.storageUrl);
      const { analyzeReferenceCompositionVision } = await loadGenerationService();
      const analysis = await analyzeReferenceCompositionVision({ data, mimeType });
      await updateReferenceVisionAnalysis(entry.id, analysis);
      setReferenceLibrary((prev) =>
        prev.map((r) => (r.id === entry.id ? { ...r, visionAnalysis: analysis } : r))
      );
    } catch (e) {
      console.error('Reanalyze reference failed', e);
      setError('Не удалось пересчитать анализ референса.');
    } finally {
      setReanalyzingReferenceId(null);
    }
  }, []);

  const handleDeleteReference = React.useCallback(async (id: string, storagePath: string) => {
    await deleteReferenceFromLibrary(id, storagePath);
    setReferenceLibrary((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleAddCardToSources = React.useCallback(async (entry: CardLibraryEntry) => {
    if (createLayoutModeRef.current === 'cover') {
      if (sourcesRef.current.length >= 4) return;
    } else {
      const plan = scenePlanRef.current;
      const roles = sceneRolesOrder(plan);
      const prev = sourcesRef.current;
      const firstEmpty = roles.find(r => !prev.some(s => s.role === r));
      const slot = firstEmpty ?? focusedSceneSlotRef.current;
      if (!roles.includes(slot)) return;
    }
    try {
      const response = await fetch(entry.storageUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onerror = () => {
        console.error('Failed to read card art blob');
        setError('Не удалось прочитать изображение карты.');
      };
      reader.onloadend = () => {
        const data = reader.result as string;
        const mime = blob.type;
        if (createLayoutModeRef.current === 'cover') {
          setSources(prev => {
            if (prev.length >= 4) return prev;
            return [...prev, { id: `lib_${entry.id}`, data, mimeType: mime }];
          });
        } else {
          setSources(prev => {
            const plan = scenePlanRef.current;
            const roles = sceneRolesOrder(plan);
            const firstEmpty = roles.find(r => !prev.some(s => s.role === r));
            let slot = firstEmpty ?? focusedSceneSlotRef.current;
            if (!roles.includes(slot)) return prev;
            const newItem: UISource = { id: `lib_${entry.id}`, data, mimeType: mime, role: slot };
            return [...prev.filter(s => s.role !== slot), newItem];
          });
        }
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error('Failed to load card art', e);
    }
  }, []);

  const handleRemoveCardFromSources = React.useCallback((sourceId: string) => {
    setSources(prev => prev.filter(s => s.id !== sourceId));
  }, []);

  const handleCreateLayoutModeChange = (mode: 'cover' | 'scene') => {
    if (mode === createLayoutMode) return;
    if (mode === 'scene') {
      setSources(prev => {
        const roles = sceneRolesOrder(scenePlan);
        return prev.slice(0, roles.length).map((s, i) => ({ ...s, role: roles[i]! }));
      });
    } else {
      setSources(prev => {
        const order = sceneRolesOrder(scenePlan);
        const sorted = order.map(r => prev.find(s => s.role === r)).filter((x): x is UISource => x != null);
        return sorted.map(({ role: _r, ...rest }) => rest);
      });
      // Inform user that slot roles were cleared
      setSceneToCoverWarning(true);
      setTimeout(() => setSceneToCoverWarning(false), 4000);
    }
    setCreateLayoutMode(mode);
  };

  const handleScenePlanChange = (plan: 2 | 3) => {
    if (plan === scenePlan) return;
    if (plan === 2) {
      setSources(prev => prev.filter(s => s.role !== 'center'));
      setFocusedSceneSlot(f => (f === 'center' ? 'left' : f));
    }
    setScenePlan(plan);
  };

  const requestSourceUploadForSlot = (slot: SceneRole) => {
    pendingSourceSlotRef.current = slot;
    setFocusedSceneSlot(slot);
    sourceInputRef.current?.click();
  };

  const canRunCover = React.useMemo(() => {
    if (createLayoutMode === 'cover') return sources.length >= 2;
    const roles = sceneRolesOrder(scenePlan);
    return roles.every(r => sources.some(s => s.role === r));
  }, [createLayoutMode, scenePlan, sources]);


  const updateReference = React.useCallback((r: ImageSource | null) => {
    setReference(r);
    if (!r) setReferenceVisionNotes(null);
  }, []);

  const selectReferenceFromLibrary = React.useCallback(async (entry: ReferenceLibraryEntry, signal?: AbortSignal) => {
    try {
      signal?.throwIfAborted();
      const match = entry.storageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match) {
        setReference({ data: entry.storageUrl, mimeType: match[1] });
        setReferenceVisionNotes(entry.visionAnalysis ?? null);
        return;
      }
      const response = await fetch(entry.storageUrl, { signal });
      if (!response.ok) throw new Error('Reference image unavailable');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Reference response is not an image');
      const data = await readFileAsDataURL(new File([blob], 'reference', { type: blob.type }));
      signal?.throwIfAborted();
      setReference({ data, mimeType: blob.type });
      setReferenceVisionNotes(entry.visionAnalysis ?? null);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.error("Failed to load library image", e);
      setError("Не удалось загрузить изображение из библиотеки.");
      throw e;
    }
  }, []);

  const availability = settings.model === 'gpt-image-2'
    ? chatGpt.checking ? 'checking' : chatGpt.connected ? 'available' : 'unavailable'
    : isOpenRouterImageModel(settings.model)
      ? checkingKey ? 'checking' : hasOpenRouter ? 'available' : 'unavailable'
    : checkingKey ? 'checking' : hasKey ? 'available' : 'unavailable';

  return (
    <div data-theme={theme} className="cover-workspace studio-workspace">
      <WorkspaceNavigation
        activeTab={activeTab}
        onSelect={setActiveTab}
        theme={theme}
        onToggleTheme={() => setTheme(current => current === 'light' ? 'dark' : 'light')}
        hidden={!!fullscreenImage}
      />

      {/* Settings Modal — centered */}
      <AnimatePresence>
        {showSettings && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-zinc-950/80"
              onClick={() => setShowSettings(false)}
            />
            {/* Modal */}
            <div className="legacy-cover-ui fixed inset-0 z-[91] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                ref={settingsDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="studio-settings-title"
                className="studio-settings-dialog w-full max-w-2xl max-h-[90vh] bg-zinc-950 border border-white/10 flex flex-col overflow-hidden pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20">
                      <Settings className="w-4 h-4 text-indigo-400" />
                    </div>
                    <h2 id="studio-settings-title" className="text-sm font-medium text-white">Системный промпт</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${baseImage ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                      {baseImage ? '⚡ Доработка' : '✨ Создание'}
                    </span>
                    {settings.strictMode && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border bg-amber-500/10 text-amber-400 border-amber-500/20">
                        🔒 Строгий
                      </span>
                    )}
                    <button
                      onClick={() => setShowSettings(false)}
                      className="p-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-full transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/5 shrink-0 px-2">
                  {([
                    { id: 'prompt', label: '✏️ Промпт' },
                    { id: 'settings', label: '⚙️ Настройки' },
                    { id: 'preview', label: '👁 API Промпт' },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setSettingsTab(tab.id)}
                      className={`px-5 py-3 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px ${settingsTab === tab.id ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto">

                  {/* Tab: Промпт */}
                  {settingsTab === 'prompt' && (
                    <div className="p-6 space-y-5">
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        Инструкции встраиваются в системный промпт при каждой генерации.
                      </p>

                      {/* Main prompt */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Дополнительный промпт</label>
                        <textarea
                          value={settings.prompt}
                          onChange={e => setSettings((s: any) => ({ ...s, prompt: e.target.value }))}
                          placeholder="Опишите что хотите видеть на изображении..."
                          rows={4}
                          className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500/50 transition-colors"
                        />
                      </div>

                      {/* Negative prompt */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Негативный промпт</label>
                        <textarea
                          value={settings.negativePrompt ?? ''}
                          onChange={e => setSettings((s: any) => ({ ...s, negativePrompt: e.target.value }))}
                          placeholder="Что исключить из изображения..."
                          rows={3}
                          className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-red-500/50 transition-colors"
                        />
                      </div>

                      {/* Strict mode */}
                      <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-900 border border-white/5">
                        <div>
                          <div className="text-xs font-bold text-zinc-200">Строгий режим</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">Vision QA-проверка и refine после генерации</div>
                        </div>
                        <button
                          disabled={settings.model === 'gpt-image-2' || isOpenRouterImageModel(settings.model)}
                          onClick={() => setSettings((s: any) => ({ ...s, strictMode: !s.strictMode }))}
                          className={`w-11 h-6 rounded-full transition-all relative shrink-0 ${settings.strictMode ? 'bg-amber-500' : 'bg-zinc-700'}`}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.strictMode ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Tab: Настройки */}
                  {settingsTab === 'settings' && (
                    <div className="p-6 space-y-6">

                      <ModelPicker options={generationModelOptions} value={settings.model} disabled={isGenerating || isUpscaling} openRouterEnabled={hasOpenRouter}
                        onChange={model => setSettings((s: any) => {
                          const openRouterSettings = normalizeOpenRouterSettings(model, s.imageSize, s.aspectRatio);
                          const normalized = normalizeGeminiImageSettings(model, openRouterSettings.imageSize, openRouterSettings.aspectRatio);
                          return {
                            ...s,
                            model,
                            ...normalized,
                          };
                        })}
                      />
                      {settings.model === 'gpt-image-2' && <ChatGptImageNotice />}
                      {isOpenRouterImageModel(settings.model) && <OpenRouterImageNotice modelId={settings.model} />}

                      {/* Aspect Ratio */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Формат (Aspect Ratio)</label>
                        <div className="flex flex-wrap gap-2">
                          {ASPECT_RATIOS.map(ratio => {
                            const openRouterModel = getOpenRouterModel(settings.model);
                            const isDisabled = !supportsGeminiAspectRatio(settings.model, ratio)
                              || Boolean(openRouterModel && openRouterModel.aspectRatios.length > 0 && !(openRouterModel.aspectRatios as readonly string[]).includes(ratio));
                            return (
                            <button
                              key={ratio}
                              disabled={isDisabled}
                              onClick={() => !isDisabled && setSettings((s: any) => ({ ...s, aspectRatio: ratio as any }))}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${isDisabled ? 'opacity-40 cursor-not-allowed bg-zinc-900 border-white/5 text-zinc-600' : settings.aspectRatio === ratio ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'}`}
                            >
                              {ratio}
                            </button>
                          )})}
                        </div>
                      </div>

                      {/* Image Size */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Разрешение</label>
                        <div className="flex gap-2">
                          {RESOLUTIONS.map(res => {
                            const openRouterModel = getOpenRouterModel(settings.model);
                            const isDisabled = settings.model === 'gpt-image-2'
                              || Boolean(openRouterModel && (openRouterModel.resolutions.length === 0 || !(openRouterModel.resolutions as readonly string[]).includes(res)))
                              || !supportsGeminiImageSize(settings.model, res);
                            return (
                              <button
                                key={res}
                                disabled={isDisabled}
                                onClick={() => !isDisabled && setSettings((s: any) => ({ ...s, imageSize: res as any }))}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${isDisabled ? 'opacity-40 cursor-not-allowed bg-zinc-900 border-white/5 text-zinc-600' : settings.imageSize === res ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'}`}
                              >
                                {res}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Batch Size */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Вариантов за генерацию</label>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4].map(n => (
                            <button
                              key={n}
                              onClick={() => setSettings((s: any) => ({ ...s, batchSize: n }))}
                              className={`w-12 h-10 rounded-xl text-sm font-bold transition-all border ${settings.batchSize === n ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'}`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tab: API Промпт */}
                  {settingsTab === 'preview' && (
                    <div className="p-6 space-y-4">

                      {/* Mode switcher */}
                      <div className="flex gap-2">
                        {([
                          { id: 'create', label: '✨ Режим создания' },
                          { id: 'edit', label: '⚡ Режим доработки' },
                        ] as const).map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSettingsPromptMode(m.id)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${settingsPromptMode === m.id ? 'bg-white border-white text-zinc-950' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'}`}
                          >
                            {m.label}
                          </button>
                        ))}
                        {((settingsPromptMode === 'create' && settings.customSystemPromptCreate?.trim()) ||
                          (settingsPromptMode === 'edit' && settings.customSystemPromptEdit?.trim())) && (
                          <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            ✏️ Изменён
                          </span>
                        )}
                      </div>

                      {/* Info about dynamic blocks */}
                      <div className="px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/15 text-[11px] text-amber-400 leading-relaxed">
                        <span className="font-bold">Динамические блоки</span> добавляются автоматически при генерации: анализ персонажей (vision), расположение сцены, описание референса композиции.
                      </div>

                      {/* Editable prompt textarea */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            {settingsPromptMode === 'create' ? 'Системный промпт (создание)' : 'Системный промпт (доработка)'}
                          </label>
                          <button
                            onClick={() => setSettings((s: any) =>
                              settingsPromptMode === 'create'
                                ? { ...s, customSystemPromptCreate: undefined }
                                : { ...s, customSystemPromptEdit: undefined }
                            )}
                            className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                          >
                            ↺ Сбросить
                          </button>
                        </div>
                        <textarea
                          value={
                            settingsPromptMode === 'create'
                              ? (settings.customSystemPromptCreate ?? DEFAULT_SYSTEM_PROMPT_CREATE)
                              : (settings.customSystemPromptEdit ?? DEFAULT_SYSTEM_PROMPT_EDIT)
                          }
                          onChange={e => setSettings((s: any) =>
                            settingsPromptMode === 'create'
                              ? { ...s, customSystemPromptCreate: e.target.value }
                              : { ...s, customSystemPromptEdit: e.target.value }
                          )}
                          rows={14}
                          spellCheck={false}
                          className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-zinc-300 font-mono leading-relaxed resize-y focus:outline-none focus:border-indigo-500/50 transition-colors"
                        />
                      </div>

                      {/* Dynamic blocks preview */}
                      <div className="rounded-xl border border-white/5 overflow-hidden">
                        <div className="px-4 py-2.5 bg-zinc-900 border-b border-white/5">
                          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Динамические блоки (только для просмотра)</span>
                        </div>
                        <pre className="p-4 text-[10px] text-zinc-600 font-mono leading-relaxed whitespace-pre-wrap">{settingsPromptMode === 'create'
? `[SOURCE_LOCK — vision analysis of character images]
${settings.strictMode ? '[STRICT MODE: prioritize pixel-exact match]\n' : ''}[SCENE LAYOUT — left/center/right roles if set]
[LAYOUT — reference composition analysis if reference provided]
USER: ${settings.prompt || '(your prompt if set)'}
AVOID: ${settings.negativePrompt ? settings.negativePrompt + ', ' : ''}redrawing, changing faces, mutation, extra limbs, collage, split-screen
[BATCH_VARIANT — if batch size > 1]`
: `USER PROMPT: ${settings.prompt || '(your prompt if set)'}
AVOID: ${settings.negativePrompt ? settings.negativePrompt + ', ' : ''}redrawing, changing faces, mutation, extra limbs, collage, split-screen`}</pre>
                      </div>
                    </div>
                  )}

                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-white/5 shrink-0">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="w-full py-3 bg-white text-zinc-950 font-black rounded-2xl hover:bg-zinc-100 transition-all text-sm uppercase tracking-widest"
                  >
                    Готово
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <main className="studio-main" id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${activeTab}`}>
        <div className="studio-screen-header">
          <h1 id="studio-screen-title" tabIndex={-1}>{workspaceTabs.find(tab => tab.id === activeTab)?.label}</h1>
          {activeTab === 'create' && (
            <div className="studio-screen-actions">
              <Button variant="ghost" disabled={isGenerating || isUpscaling} onClick={() => {
                if ((sources.length || reference || results.length || baseImage) && !window.confirm('Сбросить исходники и результаты текущей обложки? История останется на месте.')) return;
                setSources([]); updateReference(null); setResults([]); setBaseImage(null);
                setError(null); setSaveWarning(null); setGenerationNotice(null);
              }}>Сбросить</Button>
            </div>
          )}
        </div>
        {(checkingKey || !hasKey) && activeTab !== 'create' && (
          <div className="studio-capability" role="status">
            <p><strong>{checkingKey ? 'Проверяем подключение Gemini' : 'Gemini временно недоступен'}</strong>Это не влияет на подключённый ChatGPT. Сохранённые результаты и локальный редактор доступны.</p>
            {!checkingKey && <Button onClick={() => void checkKey()}>Повторить проверку</Button>}
          </div>
        )}
        <AnimatePresence>
          {(isUpscaling && (activeTab === 'history' || activeTab === 'favorites')) && (
            <motion.div
              key="upscale-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6"
            >
              <div className="relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="w-20 h-20 border-4 border-white/10 border-t-indigo-500 rounded-full"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Maximize2 className="w-8 h-8 text-indigo-500 animate-pulse" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-black tracking-tighter text-white">Улучшение качества...</h3>
                <p className="text-zinc-400">Нейросеть увеличивает разрешение</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {thumbnailVisited && (
          <Suspense
            fallback={
              <div className="flex min-h-[50vh] w-full items-center justify-center py-24" role="status" aria-label="Загрузка">
                <Loader2 className="h-9 w-9 animate-spin text-zinc-500" />
              </div>
            }
          >
            <div className="legacy-cover-ui" hidden={activeTab !== 'thumbnail'}>
              <ThumbnailTab />
            </div>
          </Suspense>
        )}

          <div
            key={activeTab}
            className={`studio-panel-enter ${activeTab === 'create' || activeTab === 'image-tools' || activeTab === 'history' || activeTab === 'favorites' ? 'w-full' : 'legacy-cover-ui w-full'}`}
          >
            <Suspense
              fallback={
                <div className="flex min-h-[50vh] w-full items-center justify-center py-24" role="status" aria-label="Загрузка">
                  <Loader2 className="h-9 w-9 animate-spin text-zinc-500" />
                </div>
              }
            >
          {activeTab === 'thumbnail' ? null : activeTab === 'image-tools' ? (
            <ImageToolsTab
              tools={imageTools}
              available={hasKey && !checkingKey && !isUpscaling && !isGenerating}
              onFullscreen={setFullscreenImage}
              onRefine={(url) => {
                setBaseImage({ data: url, mimeType: /^data:([^;]+);/.exec(url)?.[1] ?? 'image/png' });
                setActiveTab('create');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => promptRef.current?.focus(), 100);
              }}
            />
          ) : activeTab === 'create' ? (
            <CreateTab
              key="create"
              availability={availability}
              onRetryAvailability={() => void checkKey()}
              onOpenSettings={() => setShowSettings(true)}
              saveWarning={saveWarning}
              generationNotice={generationNotice}
              openRouterEnabled={hasOpenRouter}
              sources={sources}
              setSources={setSources}
              createLayoutMode={createLayoutMode}
              onCreateLayoutModeChange={handleCreateLayoutModeChange}
              scenePlan={scenePlan}
              onScenePlanChange={handleScenePlanChange}
              focusedSceneSlot={focusedSceneSlot}
              onFocusedSceneSlotChange={setFocusedSceneSlot}
              onRequestSourceUploadForSlot={requestSourceUploadForSlot}
              reference={reference}
              setReference={updateReference}
              settings={settings}
              setSettings={setSettings}
              baseImage={baseImage}
              setBaseImage={setBaseImage}
              isGenerating={isGenerating}
              handleGenerate={handleGenerate}
              generationProgress={generationProgress}
              onCancelGeneration={handleCancelGeneration}
              sceneToCoverWarning={sceneToCoverWarning}
              results={results}
              isUpscaling={isUpscaling}
              handleUpscale={handleUpscale}
              setFullscreenImage={setFullscreenImage}
              toggleLike={toggleLike}
              likedSet={likedSet}
              error={error}
              isDragging={isDragging}
              handleDragOver={handleDragOver}
              handleDragLeave={handleDragLeave}
              handleDrop={handleDrop}
              handleLocalPaste={handleLocalPaste}
              sourceInputRef={sourceInputRef}
              refInputRef={refInputRef}
              promptRef={promptRef}
              handleFileChange={handleFileChange}
              handleDragOverRef={handleDragOverRef}
              handleDragLeaveRef={handleDragLeaveRef}
              handleDropRef={handleDropRef}
              selectReferenceFromLibrary={selectReferenceFromLibrary}
              ASPECT_RATIOS={ASPECT_RATIOS}
              RESOLUTIONS={RESOLUTIONS}
              isDraggingRef={isDraggingRef}
              userReferenceLibrary={referenceLibrary}
              cardLibrary={cardLibrary}
              onAddCardSource={handleAddCardToSources}
              onRemoveCardSource={handleRemoveCardFromSources}
            />
          ) : activeTab === 'history' ? (
            <HistoryTab
              key="history"
              history={history}
              setHistory={setHistory}
              likedSet={likedSet}
              toggleLike={toggleLike}
              handleUpscale={handleUpscale}
              setFullscreenImage={setFullscreenImage}
              onRefine={(url) => {
                setBaseImage({ data: url, mimeType: 'image/png' });
                setActiveTab('create');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => promptRef.current?.focus(), 100);
              }}
            />
          ) : activeTab === 'favorites' ? (
            <FavoritesTab
              key="favorites"
              likedImages={likedImages}
              likedSet={likedSet}
              toggleLike={toggleLike}
              favoriteChoiceNotes={favoriteChoiceNotes}
              favoriteAnalysisLoadingUrl={favoriteAnalysisLoadingUrl}
              handleUpscale={handleUpscale}
              setFullscreenImage={setFullscreenImage}
              onRefine={(url) => {
                setBaseImage({ data: url, mimeType: 'image/png' });
                setActiveTab('create');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => promptRef.current?.focus(), 100);
              }}
            />
          ) : activeTab === 'references' ? (
            <ReferencesTab
              key="references"
              referenceLibrary={referenceLibrary}
              onSaveReference={handleSaveReference}
              onDeleteReference={handleDeleteReference}
              onReanalyzeReference={handleReanalyzeReference}
              reanalyzingReferenceId={reanalyzingReferenceId}
              setFullscreenImage={setFullscreenImage}
              isSaving={isSavingReference}
            />
          ) : null}
            </Suspense>
          </div>
      </main>

      <AnimatePresence>
        {fullscreenImage && (
          <React.Fragment key="image-lightbox">
          <ImageLightbox
            imageUrl={fullscreenImage}
            onClose={() => setFullscreenImage(null)}
            onPrev={lightboxIndex > 0 ? handleLightboxPrev : undefined}
            onNext={lightboxIndex < lightboxImages.length - 1 ? handleLightboxNext : undefined}
            showPrev={lightboxIndex > 0}
            showNext={lightboxIndex < lightboxImages.length - 1}
            counterLabel={lightboxImages.length > 1 ? `${lightboxIndex + 1} / ${lightboxImages.length}` : null}
          />
          </React.Fragment>
        )}
      </AnimatePresence>
    </div>
  );
}
