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
  Images
} from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import { get, set } from 'idb-keyval';
import {
  generateFusedCover,
  ImageSource,
  GenerationSettings,
  upscaleImage,
  expandImage,
  analyzeReferenceCompositionVision,
  analyzeFavoriteChoiceVision,
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
import { ASPECT_RATIOS, RESOLUTIONS } from './constants';
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
const LibraryTab = React.lazy(() =>
  import('./components/tabs/LibraryTab').then((m) => ({ default: m.LibraryTab }))
);
const ReferencesTab = React.lazy(() =>
  import('./components/tabs/ReferencesTab').then((m) => ({ default: m.ReferencesTab }))
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

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'create' | 'history' | 'favorites' | 'upscale' | 'expand' | 'library' | 'references'>('create');
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
    strictMode: true
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
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
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
          if (sbHistory.length) setHistory(sbHistory);
          else if (idbHistory) setHistory(idbHistory);
          if (sbLiked.length) setLikedImages(sbLiked);
          else if (idbLiked) setLikedImages(idbLiked);
          setCardLibrary(sbLibrary);
          setReferenceLibrary(sbRefs);
          try {
            const [idbFavNotes, sbFavNotes] = await Promise.all([
              get('fusion_favorite_choice_notes') as Promise<Record<string, string> | undefined>,
              loadFavoriteChoiceNotesMap(),
            ]);
            setFavoriteChoiceNotes({
              ...(idbFavNotes && typeof idbFavNotes === 'object' ? idbFavNotes : {}),
              ...sbFavNotes,
            });
          } catch {
            /* non-fatal */
          }
        } else {
          // Fallback to IDB only
          if (idbHistory) setHistory(idbHistory);
          if (idbLiked) setLikedImages(idbLiked);
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
    try {
      if (window.aistudio) {
        // Running inside Google AI Studio — use its key management
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        // Standalone / Vercel — key is baked in at build time via GEMINI_API_KEY env var
        setHasKey(!!process.env.GEMINI_API_KEY);
      }
    } catch (e) {
      console.error("Ошибка проверки ключа", e);
      setHasKey(!!process.env.GEMINI_API_KEY);
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
      await set('fusion_history', newHistory);
      if (isSupabaseConfigured) saveToHistory(upscaledUrl).catch(() => {});
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || "Ошибка при апскейле";
      
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
      await set('fusion_history', newHistory);
      if (isSupabaseConfigured) saveToHistory(expandedUrl).catch(() => {});
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || "Ошибка при расширении";
      setExpandResults(prev => prev.map(item => 
        item.id === expandId ? { ...item, status: 'error', error: errorMessage } : item
      ));
      setError(errorMessage);
    } finally {
      setIsExpanding(false);
    }
  }, [expandSettings, history]);

  const handleGenerate = async () => {
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
    try {
      const images = await generateFusedCover(ordered, reference, settings, baseImage, likedImages, referenceVisionNotes);
      setResults(images);

      const newHistory = [...images, ...history].slice(0, 50);
      setHistory(newHistory);
      // Save to IDB immediately (fast)
      await set('fusion_history', newHistory);
      // Also save to Supabase in background (non-blocking)
      if (isSupabaseConfigured) {
        for (const img of images) {
          saveToHistory(img).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Генерация не удалась. Пожалуйста, попробуйте снова.");
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const runFavoriteChoiceAnalysis = React.useCallback(async (url: string, favoriteRowId: string | null) => {
    setFavoriteAnalysisLoadingUrl(url);
    try {
      const chosen = await imageUrlToImageSource(url);
      const batch = resultsRef.current;
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
        if (isSupabaseConfigured) removeFromFavorites(url).catch(() => {});
        return;
      }
      const newLikes = [...likedImagesRef.current, url];
      setLikedImages(newLikes);
      likedImagesRef.current = newLikes;
      await set('fusion_liked', newLikes);
      let favId: string | null = null;
      if (isSupabaseConfigured) {
        const res = await addToFavorites(url);
        favId = res?.id ?? null;
      }
      void runFavoriteChoiceAnalysis(url, favId);
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
              : "Для работы приложения необходим Gemini API ключ. Добавьте переменную GEMINI_API_KEY в настройки окружения Vercel и пересоберите проект."}
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <motion.div 
          style={{ 
            x: bgX1,
            y: bgY1,
          }}
          className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.08)_0%,transparent_50%)]" 
        />
        <motion.div 
          style={{ 
            x: bgX2,
            y: bgY2,
          }}
          className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle_at_80%_20%,rgba(99,102,241,0.08)_0%,transparent_50%)]" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[20%] right-[10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full"
        />
        <motion.div 
          animate={{ 
            scale: [1.1, 1, 1.1],
            opacity: [0.2, 0.4, 0.2]
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-[10%] left-[10%] w-[50%] h-[50%] bg-blue-500/5 blur-[150px] rounded-full"
        />
      </div>

      {/* Header — скрыт в полноэкранном просмотре изображения */}
      <header
        className={`border-b border-white/5 bg-zinc-950/80 backdrop-blur-2xl sticky top-0 z-50 ${fullscreenImage ? 'hidden' : ''}`}
        aria-hidden={fullscreenImage ? true : undefined}
      >
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <div
              className="flex items-center gap-3 group cursor-pointer"
              onClick={() => setActiveTab('create')}
              title="Cover — главная"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveTab('create');
                }
              }}
            >
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-xl tracking-tight text-white">Cover</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mt-0.5">Обложки</span>
              </div>
            </div>

            <nav className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('create')}
                  className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'create' ? 'bg-white text-zinc-950 shadow-lg' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                >
                  <Plus className="w-4 h-4" />
                  Создать
                </button>
                <button
                  onClick={() => setActiveTab('upscale')}
                  className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'upscale' ? 'bg-white text-zinc-950 shadow-lg' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                >
                  <Maximize2 className="w-4 h-4" />
                  Апскейл
                </button>
                <button
                  onClick={() => setActiveTab('expand')}
                  className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'expand' ? 'bg-white text-zinc-950 shadow-lg' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                >
                  <Layout className="w-4 h-4" />
                  Формат
                </button>
              </div>

              <div className="h-6 w-px bg-white/10 mx-2" />

              <div className="flex items-center gap-1">
                {[
                  { id: 'history', label: 'История', icon: Layout },
                  { id: 'favorites', label: 'Избранное', icon: ImageIcon },
                  { id: 'library', label: 'Библиотека', icon: BookOpen },
                  { id: 'references', label: 'Референсы', icon: Images },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-5 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${activeTab === tab.id ? 'text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </nav>
          </div>

          <div className="flex items-center gap-6">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2.5 rounded-full bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
              title="Настройки промпта"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setSources([]); setReference(null); setResults([]); setBaseImage(null); }}
              className="text-sm font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest"
            >
              Сброс
            </button>
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || !canRunCover}
              className={`px-8 py-3 font-black rounded-full hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-xl uppercase tracking-tighter text-sm ${baseImage ? 'bg-indigo-600 text-white shadow-indigo-500/40' : 'bg-white text-zinc-950 shadow-white/20'}`}
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {baseImage ? "Доработать" : "Создать"}
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-zinc-950/60 backdrop-blur-sm"
              onClick={() => setShowSettings(false)}
            />
            {/* Drawer */}
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 h-full w-full max-w-lg z-[91] bg-zinc-950 border-l border-white/10 shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20">
                    <Settings className="w-4 h-4 text-indigo-400" />
                  </div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-white">Промпт генерации</h2>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Системный промпт, который отправляется в Gemini API при каждой генерации. Ваши настройки автоматически встраиваются в него.
                </p>

                {/* Mode Badge */}
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${baseImage ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                    {baseImage ? '⚡ Режим доработки' : '✨ Режим создания'}
                  </span>
                  {settings.strictMode && (
                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border bg-amber-500/10 text-amber-400 border-amber-500/20">
                      🔒 Строгий режим
                    </span>
                  )}
                </div>

                {/* Russian */}
                <div className="rounded-2xl overflow-hidden border border-white/5">
                  <div className="px-4 py-3 bg-blue-500/10 border-b border-white/5 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">🇷🇺 Описание (Русский)</span>
                  </div>
                  <pre className="p-5 text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap font-mono bg-zinc-950/80 max-h-72 overflow-y-auto scrollbar-thin">{baseImage
? `ЗАДАЧА: ХИРУРГИЧЕСКАЯ ДОРАБОТКА
ЦЕЛЬ: Изменить базовое изображение, используя исходного персонажа как фиксированный объект
ПРАВИЛА:
1. НУЛЕВОЕ ПЕРЕРИСОВЫВАНИЕ: лицо, волосы, глаза — 100% идентичны источнику
2. ПИКСЕЛЬНОЕ СОВПАДЕНИЕ: точные силуэты, без новых конечностей и брони
3. СТИЛЬ: яркая фэнтезийная цифровая живопись (Hearthstone)
4. ИНТЕГРАЦИЯ: единое освещение, атмосфера, контактные тени
5. ОСВЕЩЕНИЕ: один доминирующий источник, сильная подсветка контура
6. ЦВЕТ: соответствие окружающему свету среды
7. ЗАЗЕМЛЕНИЕ: реалистичные тени, соединённые с ногами
8. ПРОМПТ: ${settings.prompt ? `ТОЛЬКО: ${settings.prompt}` : 'Улучшить интеграцию'}
ИСКЛЮЧИТЬ: ${settings.negativePrompt ? `${settings.negativePrompt}, ` : ''}перерисовка, изменение лиц, мутации, лишние конечности, коллаж`
: `ЗАДАЧА: МАСТЕР-КОМПОЗИТИНГ — СЛИЯНИЕ ПЕРСОНАЖЕЙ
ПРАВИЛА:
1. НУЛЕВОЕ ПЕРЕРИСОВЫВАНИЕ: персонажи — неизменяемые объекты
2. ТОЧНОСТЬ: сохрани каждую деталь (броня, руны, волосы) в точности
3. СТИЛЬ: яркая фэнтезийная цифровая живопись (Hearthstone)
4. ОКРУЖЕНИЕ: создай НОВЫЙ фон, дополняющий освещение персонажей
5. БЕЗ КОЛЛАЖА: единая, цельная, законченная сцена
6. ОСВЕЩЕНИЕ: один доминирующий источник света
7. ЗАЗЕМЛЕНИЕ: тени у ног, без парения${settings.prompt ? `\nПОЛЬЗОВАТЕЛЬ: ${settings.prompt}` : ''}
ИСКЛЮЧИТЬ: ${settings.negativePrompt ? `${settings.negativePrompt}, ` : ''}перерисовка, изменение лиц, мутации, лишние конечности, коллаж`}</pre>
                </div>

                {/* English */}
                <div className="rounded-2xl overflow-hidden border border-white/5">
                  <div className="px-4 py-3 bg-indigo-500/10 border-b border-white/5 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">🇬🇧 API Prompt (English)</span>
                  </div>
                  <pre className="p-5 text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap font-mono bg-zinc-950/80 max-h-72 overflow-y-auto scrollbar-thin">{baseImage
? `TASK: SURGICAL REFINEMENT.
OBJECTIVE: Modify "BASE IMAGE" using "SOURCE CHARACTER" as FIXED ASSETS.
RULES:
1. ZERO REDRAWING: Faces, hair, eyes MUST be 100% identical to source.
2. PIXEL-PERFECT: Exact silhouettes. No new limbs or armor.
3. STYLE: VIBRANT FANTASY DIGITAL PAINTING (Hearthstone style).
4. INTEGRATION: Unified lighting, atmosphere, contact shadows.
5. LIGHTING: Single dominant light source. Strong rim lighting.
6. COLOR: Match environment ambient light.
7. GROUNDING: Realistic shadows connected to feet.
8. PROMPT: ${settings.prompt ? `ONLY: ${settings.prompt}` : 'Improve integration.'}
AVOID: ${settings.negativePrompt ? `${settings.negativePrompt}, ` : ''}redrawing, changing faces, mutation, extra limbs, collage, split-screen`
: `TASK: MASTER COMPOSITING - FUSE CHARACTERS.
RULES:
1. ZERO REDRAWING: Use source characters as immutable assets.
2. FIDELITY: Preserve every detail (armor, runes, hair) exactly.
3. STYLE: VIBRANT FANTASY DIGITAL PAINTING (Hearthstone style).
4. ENVIRONMENT: Generate NEW background complementing characters' lighting.
5. NO COLLAGE: One seamless, unified scene.
6. LIGHTING: One dominant light source matching characters.
7. GROUNDING: Shadows connected to feet. No floating.${settings.prompt ? `\nUSER: ${settings.prompt}` : ''}
AVOID: ${settings.negativePrompt ? `${settings.negativePrompt}, ` : ''}redrawing, changing faces, mutation, extra limbs, collage, split-screen`}</pre>
                </div>

                {/* Current Settings Summary */}
                <div className="rounded-2xl border border-white/5 overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-900 border-b border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Текущие настройки</span>
                  </div>
                  <div className="p-5 grid grid-cols-2 gap-4">
                    {[
                      { label: 'Модель', value: settings.model.replace('gemini-', 'G-').replace('-image-preview', '').replace('-image', '') },
                      { label: 'Формат', value: settings.aspectRatio },
                      { label: 'Разрешение', value: settings.imageSize },
                      { label: 'Вариантов', value: String(settings.batchSize) },
                    ].map(item => (
                      <div key={item.label} className="space-y-1">
                        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{item.label}</div>
                        <div className="text-xs font-bold text-zinc-300">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="px-8 py-5 border-t border-white/5 shrink-0">
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-white text-zinc-950 font-black rounded-2xl hover:bg-zinc-100 transition-all text-sm uppercase tracking-widest"
                >
                  Закрыть
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto p-6 relative z-10">
        <AnimatePresence mode="wait">
          {(isUpscaling && (activeTab === 'history' || activeTab === 'favorites')) && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6"
            >
              <div className="relative">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
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

          <Suspense
            fallback={
              <div className="flex min-h-[50vh] w-full items-center justify-center py-24" role="status" aria-label="Загрузка">
                <Loader2 className="h-9 w-9 animate-spin text-zinc-500" />
              </div>
            }
          >
          {activeTab === 'upscale' ? (
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
          ) : activeTab === 'library' ? (
            <LibraryTab
              key="library"
              cardLibrary={cardLibrary}
              onSaveCard={handleSaveCard}
              onDeleteCard={handleDeleteCard}
              setFullscreenImage={setFullscreenImage}
              isSaving={isSavingCard}
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
