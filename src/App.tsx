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
  Paintbrush,
} from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import { get, set } from 'idb-keyval';
import {
  generateFusedCover,
  type CoverGenerationProgress,
  ImageSource,
  GenerationSettings,
  DEFAULT_SYSTEM_PROMPT_CREATE,
  DEFAULT_SYSTEM_PROMPT_EDIT,
  upscaleImage,
  expandImage,
  analyzeReferenceCompositionVision,
  analyzeFavoriteChoiceVision,
  formatGeminiError,
  sceneRolesOrder,
  type SceneRole,
} from './services/geminiService';
import {
  isSupabaseConfigured,
  loadCardLibrary, saveCardToLibrary, deleteCardFromLibrary,
  loadReferenceLibrary, saveReferenceToLibrary, deleteReferenceFromLibrary, updateReferenceVisionAnalysis, fetchUrlAsImageSource,
  loadHistory, saveToHistory, clearHistory,
  loadFavorites, addToFavorites, removeFromFavorites,
  updateFavoriteChoiceAnalysis,
  loadFavoriteChoiceNotesMap,
  imageUrlToImageSource,
  migrateFromIDB,
  type CardLibraryEntry,
  type ReferenceLibraryEntry,
} from './services/supabaseService';
import { ASPECT_RATIOS, RESOLUTIONS, GENERATION_MODELS, MODELS_NO_512PX } from './constants';
import { ImageLightbox } from './components/ImageLightbox';

const CreateTab = React.lazy(() =>
  import('./components/tabs/CreateTab').then((m) => ({ default: m.CreateTab }))
);
const UpscaleTab = React.lazy(() =>
  import('./components/tabs/UpscaleTab').then((m) => ({ default: m.UpscaleTab }))
);
const ExpandTab = React.lazy(() =>
  import('./components/tabs/ExpandTab').then((m) => ({ default: m.ExpandTab }))
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

interface UpscaleItem {
  id: string;
  originalUrl: string;
  upscaledUrl?: string;
  status: 'loading' | 'done' | 'error';
  error?: string;
  resolution?: string;
}

interface UISource extends ImageSource {
  id: string;
  role?: SceneRole;
}

type ActiveTab = 'create' | 'thumbnail' | 'history' | 'favorites' | 'upscale' | 'expand' | 'references';

const PRIMARY_NAV_TABS = [
  { id: 'create' as const, label: 'Создать', caption: 'Генерация', icon: Plus },
  { id: 'thumbnail' as const, label: 'HS-обложка', caption: 'YouTube', icon: Paintbrush },
  { id: 'upscale' as const, label: 'Апскейл', caption: '4K', icon: Maximize2 },
  { id: 'expand' as const, label: 'Формат', caption: 'Расширить', icon: Layout },
];

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function browserMediaFallback(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => {
    if (typeof item !== 'string') return false;
    return item.startsWith('data:image/') || item.startsWith('blob:');
  });
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('create');
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [sources, setSources] = useState<UISource[]>([]);
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
  const [upscaleSource, setUpscaleSource] = useState<ImageSource | null>(null);
  const [expandSource, setExpandSource] = useState<ImageSource | null>(null);
  const [upscaleResults, setUpscaleResults] = useState<UpscaleItem[]>([]);
  const [expandResults, setExpandResults] = useState<UpscaleItem[]>([]);
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
    strictMode: true,
    preserveExactArt: true,
  });
  const [upscaleSettings, setUpscaleSettings] = useState<{ model: string, imageSize: "1K" | "2K" | "4K" }>({
    model: "gemini-3.1-flash-image-preview",
    imageSize: "4K"
  });
  const [expandSettings, setExpandSettings] = useState<{ model: string, aspectRatio: string, prompt: string }>({
    model: "gemini-3.1-flash-image-preview",
    aspectRatio: "16:9",
    prompt: ""
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
  const [isExpanding, setIsExpanding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [hasBriaRmbg, setHasBriaRmbg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'prompt' | 'settings' | 'preview'>('prompt');
  const [settingsPromptMode, setSettingsPromptMode] = useState<'create' | 'edit'>('create');
  const [generationProgress, setGenerationProgress] = useState<CoverGenerationProgress | null>(null);
  const cancelGenerationRef = useRef(false);
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

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { damping: 50, stiffness: 400 });
  const springY = useSpring(mouseY, { damping: 50, stiffness: 400 });

  const bgX1 = useTransform(springX, [0, 2000], [-50, 50]);
  const bgY1 = useTransform(springY, [0, 1200], [-50, 50]);
  const bgX2 = useTransform(springX, [0, 2000], [50, -50]);
  const bgY2 = useTransform(springY, [0, 1200], [50, -50]);

  useEffect(() => {
    let rafId: number;
    const handleMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        mouseX.set(e.clientX);
        mouseY.set(e.clientY);
      });
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

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

        // ── Load from Supabase (if configured) ───────────────────────────
        if (isSupabaseConfigured) {
          try {
            await migrateFromIDB();
          } catch {
            /* non-fatal */
          }

          const [sbHistory, sbLiked, sbLibrary, sbRefs] = await Promise.all([
            loadHistory(),
            loadFavorites(),
            loadCardLibrary(),
            loadReferenceLibrary(),
          ]);
          setHistory(sbHistory);
          setLikedImages(sbLiked);
          setCardLibrary(sbLibrary);
          setReferenceLibrary(sbRefs);
          try {
            setFavoriteChoiceNotes(await loadFavoriteChoiceNotesMap());
          } catch {
            /* non-fatal */
          }
        } else {
          // Fallback to IDB only
          setHistory(browserMediaFallback(idbHistory));
          setLikedImages(browserMediaFallback(idbLiked));
          try {
            const idbFavNotes = await get('fusion_favorite_choice_notes') as Record<string, string> | undefined;
            if (idbFavNotes && typeof idbFavNotes === 'object') setFavoriteChoiceNotes(idbFavNotes);
          } catch {
            /* non-fatal */
          }
        }
      } catch (e) {
        console.error("Failed to load data", e);
        // Fallback to IDB
        try {
          const idbHistory = await get('fusion_history');
          const idbLiked = await get('fusion_liked');
          setHistory(browserMediaFallback(idbHistory));
          setLikedImages(browserMediaFallback(idbLiked));
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
    try {
      if (window.aistudio) {
        // Running inside Google AI Studio — use its key management
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        const response = await fetch('/api/runtime-capabilities', { credentials: 'same-origin' });
        const capabilities = response.ok ? await response.json() : null;
        setHasKey(capabilities?.gemini === true);
        setHasBriaRmbg(capabilities?.briaRmbg === true);
      }
    } catch (e) {
      console.error("Ошибка проверки ключа", e);
      setHasKey(false);
      setHasBriaRmbg(false);
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

  const handleUpscale = React.useCallback(async (url: string, existingId?: string) => {
    const upscaleId = existingId || Math.random().toString(36).substring(7);
    const currentRes = upscaleSettings.imageSize;
    
    if (activeTab === 'upscale') {
      if (existingId) {
        setUpscaleResults(prev => prev.map(item => 
          item.id === existingId ? { ...item, status: 'loading', error: undefined, resolution: currentRes } : item
        ));
      } else {
        setUpscaleResults(prev => [{ id: upscaleId, originalUrl: url, status: 'loading', resolution: currentRes }, ...prev]);
        setUpscaleSource(null);
      }
    } else {
      setIsUpscaling(true);
    }
    
    setError(null);
    try {
      const upscaledUrl = await upscaleImage({ data: url, mimeType: 'image/png' }, upscaleSettings.imageSize, upscaleSettings.model);
      
      if (activeTab === 'upscale') {
        setUpscaleResults(prev => prev.map(item => 
          item.id === upscaleId ? { ...item, upscaledUrl, status: 'done' } : item
        ));
      } else {
        if (existingId) {
          setUpscaleResults(prev => prev.map(item => 
            item.id === existingId ? { ...item, upscaledUrl, status: 'done', resolution: currentRes } : item
          ));
        } else {
          setUpscaleResults(prev => [{ id: upscaleId, originalUrl: url, upscaledUrl, status: 'done', resolution: currentRes }, ...prev]);
        }
        if (activeTab === 'create') {
          setResults(prev => [upscaledUrl, ...prev]);
        }
      }
      
      const newHistory = [upscaledUrl, ...history].slice(0, 50);
      setHistory(newHistory);
      if (isSupabaseConfigured) saveToHistory(upscaledUrl).catch(() => {});
      else await set('fusion_history', newHistory);
    } catch (err: any) {
      console.error(err);
      const errorMessage = formatGeminiError(err);
      
      if (activeTab === 'upscale') {
        setUpscaleResults(prev => prev.map(item => 
          item.id === upscaleId ? { ...item, status: 'error', error: errorMessage } : item
        ));
      } else {
        setError(errorMessage);
      }
    } finally {
      if (activeTab !== 'upscale') {
        setIsUpscaling(false);
      }
    }
  }, [activeTab, upscaleSettings, history]);

  const handleExpand = React.useCallback(async (url: string) => {
    const expandId = Math.random().toString(36).substring(7);
    
    setExpandResults(prev => [{ id: expandId, originalUrl: url, status: 'loading', resolution: expandSettings.aspectRatio }, ...prev]);
    setExpandSource(null);
    setIsExpanding(true);
    setError(null);

    try {
      const expandedUrl = await expandImage(
        { data: url, mimeType: 'image/png' }, 
        expandSettings.aspectRatio as any, 
        expandSettings.prompt, 
        expandSettings.model
      );
      
      setExpandResults(prev => prev.map(item => 
        item.id === expandId ? { ...item, upscaledUrl: expandedUrl, status: 'done' } : item
      ));
      
      const newHistory = [expandedUrl, ...history].slice(0, 50);
      setHistory(newHistory);
      if (isSupabaseConfigured) saveToHistory(expandedUrl).catch(() => {});
      else await set('fusion_history', newHistory);
    } catch (err: any) {
      console.error(err);
      const errorMessage = formatGeminiError(err);
      setExpandResults(prev => prev.map(item => 
        item.id === expandId ? { ...item, status: 'error', error: errorMessage } : item
      ));
      setError(errorMessage);
    } finally {
      setIsExpanding(false);
    }
  }, [expandSettings, history]);

  const handleGenerate = async () => {
    if (settings.preserveExactArt && !hasBriaRmbg) {
      setError('Точное сохранение исходного арта пока не готово на сервере. Отключите этот режим или повторите позже.');
      return;
    }
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
    cancelGenerationRef.current = false;
    setGenerationProgress({
      done: 0,
      total: settings.batchSize,
      phase: 'preparing',
    });
    try {
      const images = await generateFusedCover(
        ordered, reference, settings, baseImage, likedImages, referenceVisionNotes,
        (p) => setGenerationProgress(p)
      );

      if (cancelGenerationRef.current) return;

      setResults(images);
      const newHistory = [...images, ...history].slice(0, 100);
      setHistory(newHistory);
      if (isSupabaseConfigured) {
        for (const img of images) {
          saveToHistory(img).catch(() => {});
        }
      } else {
        await set('fusion_history', newHistory);
      }
    } catch (err: any) {
      if (cancelGenerationRef.current) return;
      console.error(err);
      setError(formatGeminiError(err));
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
      }
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleCancelGeneration = () => {
    cancelGenerationRef.current = true;
    setIsGenerating(false);
    setGenerationProgress(null);
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
      const text = await analyzeFavoriteChoiceVision(chosen, alternatives, {
        userPromptHint: settingsRef.current.prompt,
      });
      setFavoriteChoiceNotes(prev => ({ ...prev, [url]: text }));
      const existing = (await get('fusion_favorite_choice_notes')) as Record<string, string> | undefined;
      await set('fusion_favorite_choice_notes', {
        ...(existing && typeof existing === 'object' ? existing : {}),
        [url]: text,
      });
      if (favoriteRowId && isSupabaseConfigured) {
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
        if (!isSupabaseConfigured) await set('fusion_liked', newLikes);
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
        if (isSupabaseConfigured) removeFromFavorites(url).catch(() => {});
        return;
      }
      const newLikes = [...likedImagesRef.current, url];
      setLikedImages(newLikes);
      likedImagesRef.current = newLikes;
      let favId: string | null = null;
      if (isSupabaseConfigured) {
        const res = await addToFavorites(url);
        favId = res?.id ?? null;
        if (!res) await set('fusion_liked', newLikes);
      } else {
        await set('fusion_liked', newLikes);
      }
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

  const primaryNavTabs = PRIMARY_NAV_TABS;
  const libraryNavTabs = [
    { id: 'history' as const, label: 'История', caption: `${history.length}`, icon: Layout },
    { id: 'favorites' as const, label: 'Избранное', caption: `${likedImages.length}`, icon: ImageIcon },
    { id: 'references' as const, label: 'Референсы', caption: `${referenceLibrary.length}`, icon: Images },
  ];
  const activeTabMeta = [...primaryNavTabs, ...libraryNavTabs].find(tab => tab.id === activeTab);
  const generationQueue = [
    { id: 'preparing', label: 'Анализ', active: generationProgress?.phase === 'preparing', done: Boolean(generationProgress) && generationProgress.phase !== 'preparing' },
    { id: 'generating', label: 'Генерация', active: generationProgress?.phase === 'generating', done: Boolean(generationProgress) && generationProgress.phase === 'strict' },
    { id: 'strict', label: 'QA', active: generationProgress?.phase === 'strict', done: false },
  ];

  const updateReference = React.useCallback((r: ImageSource | null) => {
    setReference(r);
    if (!r) setReferenceVisionNotes(null);
  }, []);

  const selectReferenceFromLibrary = React.useCallback(async (entry: ReferenceLibraryEntry) => {
    setReferenceVisionNotes(entry.visionAnalysis ?? null);
    try {
      const match = entry.storageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match) {
        setReference({ data: entry.storageUrl, mimeType: match[1] });
        return;
      }
      const response = await fetch(entry.storageUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        setReference({ data: reader.result as string, mimeType: blob.type });
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error("Failed to load library image", e);
      setError("Не удалось загрузить изображение из библиотеки.");
    }
  }, []);

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        {/* Interactive Background */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <motion.div 
            animate={{ 
              x: [0, 100, 0], 
              y: [0, 50, 0],
              scale: [1, 1.2, 1]
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.1)_0%,transparent_50%)]" 
          />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 max-w-xl w-full"
        >
          <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-blue-500/20 border border-white/10">
            <Sparkles className="w-12 h-12 text-white" />
          </div>
          <div className="mb-4">
            <h1 className="text-5xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">
              Cover
            </h1>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-zinc-500 mt-2">Обложки с ИИ</p>
          </div>
          <p className="text-zinc-400 text-lg leading-relaxed mb-10">
            {window.aistudio
              ? "Для начала работы необходимо выбрать API ключ Gemini. Это бесплатно и безопасно."
              : "Генератор временно недоступен. Проверьте серверную конфигурацию Cover."}
          </p>

          <div className="space-y-4">
            {window.aistudio ? (
              <button
                onClick={handleOpenKeyDialog}
                className="w-full py-5 bg-white text-zinc-950 font-bold rounded-2xl hover:bg-zinc-100 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 shadow-xl"
              >
                Выбрать API ключ
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-5 bg-white text-zinc-950 font-bold rounded-2xl hover:bg-zinc-100 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 shadow-xl"
              >
                Получить API ключ
                <ChevronRight className="w-5 h-5" />
              </a>
            )}
            <p className="mt-6 text-xs text-zinc-500">
              Узнать больше о <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline hover:text-zinc-400 transition-colors">биллинге Gemini API</a>.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas font-sans text-zinc-100">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <motion.div 
          style={{ 
            x: bgX1,
            y: bgY1,
          }}
          className="absolute left-[-20%] top-[-20%] h-[140%] w-[140%] bg-[radial-gradient(circle_at_50%_50%,rgba(240,184,75,0.035)_0%,transparent_48%)]"
        />
        <motion.div 
          style={{ 
            x: bgX2,
            y: bgY2,
          }}
          className="absolute left-[-20%] top-[-20%] h-[140%] w-[140%] bg-[radial-gradient(circle_at_80%_20%,rgba(116,82,166,0.035)_0%,transparent_48%)]"
        />
      </div>

      {/* Sidebar — скрыт в полноэкранном просмотре изображения */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 hidden w-[244px] border-r border-line bg-canvas/95 backdrop-blur-xl lg:flex lg:flex-col ${fullscreenImage ? 'lg:hidden' : ''}`}
        aria-hidden={fullscreenImage ? true : undefined}
      >
        <div className="flex h-full flex-col px-3 py-4">
          <button
            type="button"
            className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5 text-left transition-colors hover:border-line-strong hover:bg-panel-raised"
            onClick={() => setActiveTab('create')}
            title="Cover — главная"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-zinc-950 shadow-lg shadow-amber-950/20 transition-transform group-hover:scale-105">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <span className="block font-display text-xl font-black tracking-tight text-white">Cover</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-500">AI deck studio</span>
            </div>
          </button>

          <nav className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
            <div className="space-y-2">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Инструменты</p>
              {primaryNavTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${activeTab === tab.id ? 'bg-accent text-zinc-950 shadow-lg shadow-amber-950/20' : 'text-zinc-400 hover:bg-panel-raised hover:text-white'}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${activeTab === tab.id ? 'bg-zinc-950 text-accent-bright' : 'bg-panel-soft text-zinc-400 group-hover:text-accent-bright'}`}>
                    <tab.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{tab.label}</span>
                    <span className={`block text-[9px] font-semibold uppercase tracking-[0.16em] ${activeTab === tab.id ? 'text-zinc-700' : 'text-zinc-600'}`}>{tab.caption}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Хранилище</p>
              {libraryNavTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${activeTab === tab.id ? 'bg-accent-soft text-accent-bright ring-1 ring-amber-300/25' : 'text-zinc-400 hover:bg-panel-raised hover:text-white'}`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-soft text-zinc-400">
                    <tab.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{tab.label}</span>
                  <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 ring-1 ring-line">{tab.caption}</span>
                </button>
              ))}
            </div>
          </nav>

          {activeTab !== 'thumbnail' ? (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <AnimatePresence>
              {isGenerating && generationProgress && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">Queue</span>
                    <span className="text-[10px] font-black text-white">{generationProgress.done}/{generationProgress.total}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {generationQueue.map((step) => (
                      <div key={step.id} className={`h-1.5 rounded-full ${step.active ? 'bg-white' : step.done ? 'bg-emerald-400' : 'bg-white/15'}`} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs font-black text-zinc-200 transition-all hover:bg-white/12 hover:text-white"
                title="Настройки промпта"
              >
                <Settings className="h-4 w-4" />
                Промпт
              </button>
              <button
                type="button"
                onClick={() => { setSources([]); setReference(null); setResults([]); setBaseImage(null); }}
                className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs font-black uppercase tracking-widest text-zinc-500 transition-all hover:bg-red-500/10 hover:text-red-300"
              >
                Сброс
              </button>
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !canRunCover}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-black uppercase tracking-tight shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${baseImage ? 'bg-indigo-600 text-white shadow-indigo-500/35' : 'bg-white text-zinc-950 shadow-white/15'}`}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {baseImage ? 'Доработать' : 'Создать'}
            </button>
          </div>
          ) : (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-accent-soft p-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-bright">
              <Paintbrush className="h-3.5 w-3.5" /> Редактор обложки
            </div>
          )}
        </div>
      </aside>

      {!fullscreenImage && (
        <header className="sticky top-0 z-50 border-b border-line bg-canvas/92 backdrop-blur-2xl lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <button type="button" onClick={() => setActiveTab('create')} className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-zinc-950">
                <Sparkles className="h-5 w-5" />
              </span>
              <span className="min-w-0 text-left">
                <span className="block font-display text-base font-black text-white">Cover</span>
                <span className="block truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{activeTabMeta?.label}</span>
              </span>
            </button>
            {activeTab !== 'thumbnail' ? <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !canRunCover}
              className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black uppercase disabled:opacity-45 ${baseImage ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-950'}`}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {baseImage ? 'Доработать' : 'Создать'}
            </button> : <span className="rounded-xl bg-accent-soft px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-bright">Редактор 16:9</span>}
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
            {[...primaryNavTabs, ...libraryNavTabs].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${activeTab === tab.id ? 'bg-accent text-zinc-950' : 'bg-panel text-zinc-400'}`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-black text-zinc-400"
            >
              <Settings className="h-4 w-4" />
              Промпт
            </button>
          </nav>
          {isGenerating && generationProgress && (
            <div className="h-1 overflow-hidden bg-zinc-900">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-300"
                initial={{ width: '0%' }}
                animate={{ width: generationProgress.phase === 'generating' ? `${Math.min(100, (generationProgress.done / Math.max(1, generationProgress.total)) * 100)}%` : '62%' }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
              />
            </div>
          )}
        </header>
      )}

      {/* Settings Modal — centered */}
      <AnimatePresence>
        {showSettings && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-zinc-950/80 backdrop-blur-md"
              onClick={() => setShowSettings(false)}
            />
            {/* Modal */}
            <div className="fixed inset-0 z-[91] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className="w-full max-w-2xl max-h-[90vh] bg-zinc-950 border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20">
                      <Settings className="w-4 h-4 text-indigo-400" />
                    </div>
                    <h2 className="text-sm font-black uppercase tracking-widest text-white">Промпт генерации</h2>
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

                      {/* Model */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Модель</label>
                        <div className="space-y-2">
                          {GENERATION_MODELS.map(m => (
                            <button
                              key={m.id}
                              onClick={() => setSettings((s: any) => ({
                                ...s,
                                model: m.id,
                                imageSize: (MODELS_NO_512PX.has(m.id) && s.imageSize === "512px") ? "1K" : s.imageSize
                              }))}
                              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${settings.model === m.id ? 'bg-indigo-500/10 border-indigo-500/30 text-white' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'}`}
                            >
                              <div>
                                <div className="text-xs font-bold">{m.name}</div>
                                <div className="text-[11px] text-zinc-500 mt-0.5">{m.desc}</div>
                              </div>
                              {settings.model === m.id && <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Aspect Ratio */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Формат (Aspect Ratio)</label>
                        <div className="flex flex-wrap gap-2">
                          {ASPECT_RATIOS.map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setSettings((s: any) => ({ ...s, aspectRatio: ratio as any }))}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${settings.aspectRatio === ratio ? 'bg-white border-white text-zinc-950 shadow-md' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'}`}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Image Size */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Разрешение</label>
                        <div className="flex gap-2">
                          {RESOLUTIONS.map(res => {
                            const isDisabled = MODELS_NO_512PX.has(settings.model) && res === "512px";
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

      <main className="relative z-10 mx-auto w-full max-w-[1720px] p-4 sm:p-6 lg:ml-[244px] lg:w-[calc(100%-244px)] lg:p-7 xl:p-8">
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

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full"
          >
            <Suspense
              fallback={
                <div className="flex min-h-[50vh] w-full items-center justify-center py-24" role="status" aria-label="Загрузка">
                  <Loader2 className="h-9 w-9 animate-spin text-zinc-500" />
                </div>
              }
            >
          {activeTab === 'thumbnail' ? (
            <ThumbnailTab key="thumbnail" />
          ) : activeTab === 'upscale' ? (
            <UpscaleTab 
              key="upscale"
              upscaleSource={upscaleSource}
              setUpscaleSource={setUpscaleSource}
              upscaleSettings={upscaleSettings}
              setUpscaleSettings={setUpscaleSettings}
              isUpscaling={isUpscaling}
              handleUpscale={handleUpscale}
              upscaleResults={upscaleResults}
              setUpscaleResults={setUpscaleResults}
              setFullscreenImage={setFullscreenImage}
              onRefine={(url) => {
                setBaseImage({ data: url, mimeType: 'image/png' });
                setActiveTab('create');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => promptRef.current?.focus(), 100);
              }}
              error={error}
            />
          ) : activeTab === 'expand' ? (
            <ExpandTab 
              key="expand"
              expandSource={expandSource}
              setExpandSource={setExpandSource}
              expandSettings={expandSettings}
              setExpandSettings={setExpandSettings}
              isExpanding={isExpanding}
              handleExpand={handleExpand}
              expandResults={expandResults}
              setExpandResults={setExpandResults}
              setFullscreenImage={setFullscreenImage}
              onRefine={(url) => {
                setBaseImage({ data: url, mimeType: 'image/png' });
                setActiveTab('create');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => promptRef.current?.focus(), 100);
              }}
              error={error}
              ASPECT_RATIOS={ASPECT_RATIOS}
            />
          ) : activeTab === 'create' ? (
            <CreateTab
              key="create"
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
              setHistory={async (newHistory) => {
                if (typeof newHistory === 'function') {
                  setHistory(newHistory);
                } else {
                  setHistory(newHistory);
                  clearHistory().catch(() => {});
                }
              }}
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
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {fullscreenImage && (
          <React.Fragment key={fullscreenImage}>
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
