/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  X,
  ImageIcon,
  Layout,
  Plus,
  Maximize2,
  Loader2,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import { get, set } from 'idb-keyval';
import { generateFusedCover, ImageSource, GenerationSettings, upscaleImage, expandImage } from './services/geminiService';
import { CreateTab } from './components/tabs/CreateTab';
import { UpscaleTab } from './components/tabs/UpscaleTab';
import { ExpandTab } from './components/tabs/ExpandTab';
import { HistoryTab } from './components/tabs/HistoryTab';
import { FavoritesTab } from './components/tabs/FavoritesTab';
import { REFERENCE_LIBRARY, ASPECT_RATIOS, RESOLUTIONS } from './constants';

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
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'create' | 'history' | 'favorites' | 'upscale' | 'expand'>('create');
  const [sources, setSources] = useState<UISource[]>([]);
  const [upscaleSource, setUpscaleSource] = useState<ImageSource | null>(null);
  const [expandSource, setExpandSource] = useState<ImageSource | null>(null);
  const [upscaleResults, setUpscaleResults] = useState<UpscaleItem[]>([]);
  const [expandResults, setExpandResults] = useState<UpscaleItem[]>([]);
  const sourcesRef = useRef<UISource[]>([]);
  
  const [likedImages, setLikedImages] = useState<string[]>([]);
  
  // Memoized values for performance
  const likedSet = React.useMemo(() => new Set(likedImages), [likedImages]);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  const [reference, setReference] = useState<ImageSource | null>(null);
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
  const [history, setHistory] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lightbox gallery context — derive image list from current active tab
  const lightboxImages = React.useMemo(() => {
    if (!fullscreenImage) return [] as string[];
    if (activeTab === 'create') return results;
    if (activeTab === 'history') return history;
    if (activeTab === 'favorites') return likedImages;
    return [fullscreenImage];
  }, [fullscreenImage, activeTab, results, history, likedImages]);

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
        const localHistory = localStorage.getItem('fusion_history');
        const localLiked = localStorage.getItem('fusion_liked');

        let idbHistory = await get('fusion_history');
        let idbLiked = await get('fusion_liked');

        let migrated = false;
        if (localHistory && !idbHistory) {
          idbHistory = JSON.parse(localHistory);
          await set('fusion_history', idbHistory);
          localStorage.removeItem('fusion_history');
          migrated = true;
        }
        if (localLiked && !idbLiked) {
          idbLiked = JSON.parse(localLiked);
          await set('fusion_liked', idbLiked);
          localStorage.removeItem('fusion_liked');
          migrated = true;
        }

        if (idbHistory) setHistory(idbHistory);
        if (idbLiked) setLikedImages(idbLiked);
      } catch (e) {
        console.error("Failed to load data", e);
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
      // Skip if target is an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            if (sourcesRef.current.length < 4) {
              processFile(file, 'source');
            } else {
              processFile(file, 'reference');
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

  const processFile = (file: File, type: 'source' | 'reference') => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (type === 'source') {
        setSources(prev => {
          if (prev.length < 4) {
            return [...prev, { id: Math.random().toString(36).substring(7), data: base64, mimeType: file.type }];
          }
          return prev;
        });
      } else {
        setReference({ data: base64, mimeType: file.type });
      }
    };
    reader.onerror = () => {
      setError("Не удалось прочитать файл. Пожалуйста, попробуйте снова.");
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'source' | 'reference') => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => processFile(file, type));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        processFile(file, 'source');
      }
    });
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
    if (sources.length < 2) {
      setError("Пожалуйста, загрузите хотя бы 2 изображения.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    try {
      const images = await generateFusedCover(sources, reference, settings, baseImage, likedImages);
      setResults(images);
      
      const newHistory = [...images, ...history].slice(0, 50);
      setHistory(newHistory);
      await set('fusion_history', newHistory);
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

  const toggleLike = React.useCallback(async (url: string) => {
    setLikedImages(prev => {
      const newLikes = prev.includes(url) 
        ? prev.filter(item => item !== url)
        : [...prev, url];
      set('fusion_liked', newLikes).catch(e => console.error(e));
      return newLikes;
    });
  }, []);

  const selectFromLibrary = async (url: string) => {
    try {
      // If already a data URL, use directly
      const match = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        setReference({ data: url, mimeType: match[1] });
        return;
      }
      // Fetch external URL and convert to base64 data URL
      const response = await fetch(url);
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
  };

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
          <h1 className="text-5xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">
            Fusion AI
          </h1>
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

      {/* Header */}
      <header className="border-b border-white/5 bg-zinc-950/80 backdrop-blur-2xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-3 group cursor-pointer" onClick={() => setActiveTab('create')}>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="font-black text-xl tracking-tighter uppercase text-white">Fusion</span>
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
                  { id: 'favorites', label: 'Избранное', icon: ImageIcon }
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
              onClick={() => { setSources([]); setReference(null); setResults([]); setBaseImage(null); }}
              className="text-sm font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest"
            >
              Сброс
            </button>
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || sources.length < 2}
              className={`px-8 py-3 font-black rounded-full hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-xl uppercase tracking-tighter text-sm ${baseImage ? 'bg-indigo-600 text-white shadow-indigo-500/40' : 'bg-white text-zinc-950 shadow-white/20'}`}
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {baseImage ? "Доработать" : "Создать"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 relative z-10">
        <AnimatePresence>
          {fullscreenImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-zinc-950/97 backdrop-blur-2xl flex items-center justify-center p-4"
              onClick={() => setFullscreenImage(null)}
            >
              {/* Close */}
              <button
                onClick={() => setFullscreenImage(null)}
                className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-10"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Counter */}
              {lightboxImages.length > 1 && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-xs font-black text-white tracking-widest z-10">
                  {lightboxIndex + 1} / {lightboxImages.length}
                </div>
              )}

              {/* Prev */}
              {lightboxIndex > 0 && (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={(e) => { e.stopPropagation(); handleLightboxPrev(); }}
                  className="absolute left-6 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all hover:scale-110 z-10"
                >
                  <ChevronLeft className="w-7 h-7" />
                </motion.button>
              )}

              {/* Image */}
              <motion.img
                key={fullscreenImage}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15 }}
                src={fullscreenImage}
                className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                referrerPolicy="no-referrer"
              />

              {/* Next */}
              {lightboxIndex < lightboxImages.length - 1 && (
                <motion.button
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={(e) => { e.stopPropagation(); handleLightboxNext(); }}
                  className="absolute right-6 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all hover:scale-110 z-10"
                >
                  <ChevronRight className="w-7 h-7" />
                </motion.button>
              )}

              {/* Keyboard hint */}
              {lightboxImages.length > 1 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[10px] text-zinc-500 font-black uppercase tracking-widest">
                  <span>← → навигация</span>
                  <span>·</span>
                  <span>ESC закрыть</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

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
              reference={reference}
              setReference={setReference}
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
              selectFromLibrary={selectFromLibrary}
              REFERENCE_LIBRARY={REFERENCE_LIBRARY}
              ASPECT_RATIOS={ASPECT_RATIOS}
              RESOLUTIONS={RESOLUTIONS}
              isDraggingRef={isDraggingRef}
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
          ) : (
            <FavoritesTab 
              key="favorites"
              likedImages={likedImages}
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
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
