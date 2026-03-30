import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { mapClientToCanvasCoords, type Rect } from '../lib/canvasCoords';

const MARKER_COLORS = [
  { id: 'yellow', stroke: '#facc15' },
  { id: 'red', stroke: '#ef4444' },
  { id: 'green', stroke: '#22c55e' },
  { id: 'white', stroke: '#ffffff' },
  { id: 'blue', stroke: '#3b82f6' },
  { id: 'violet', stroke: '#a855f7' },
] as const;

export interface ImageLightboxProps {
  imageUrl: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  showPrev: boolean;
  showNext: boolean;
  counterLabel: string | null;
}

export function ImageLightbox({
  imageUrl,
  onClose,
  onPrev,
  onNext,
  showPrev,
  showNext,
  counterLabel,
}: ImageLightboxProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [strokeColor, setStrokeColor] = useState(MARKER_COLORS[0].stroke);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 1 || h < 1) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    clearCanvas();
    lastPointRef.current = null;
  }, [imageUrl, clearCanvas]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      resizeCanvas();
    });
    const el = wrapRef.current;
    if (el) ro.observe(el);
    window.addEventListener('resize', resizeCanvas);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [resizeCanvas]);

  const getPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const r: Rect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    return mapClientToCanvasCoords(clientX, clientY, r, canvas.width, canvas.height);
  }, []);

  const drawSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    },
    [strokeColor]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawMode) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = getPoint(e.clientX, e.clientY);
    if (p) lastPointRef.current = p;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawMode || !drawingRef.current) return;
    e.stopPropagation();
    const p = getPoint(e.clientX, e.clientY);
    const last = lastPointRef.current;
    if (p && last) {
      drawSegment(last, p);
      lastPointRef.current = p;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawMode) return;
    e.stopPropagation();
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-zinc-950 flex flex-col items-center justify-center p-4 pt-16 pb-28"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-10"
        aria-label="Закрыть"
      >
        <X className="w-6 h-6" />
      </button>

      {counterLabel && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-xs font-black text-white tracking-widest z-10">
          {counterLabel}
        </div>
      )}

      {showPrev && onPrev && (
        <motion.button
          type="button"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all hover:scale-110 z-10"
          aria-label="Предыдущее"
        >
          <ChevronLeft className="w-7 h-7" />
        </motion.button>
      )}

      {showNext && onNext && (
        <motion.button
          type="button"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all hover:scale-110 z-10"
          aria-label="Следующее"
        >
          <ChevronRight className="w-7 h-7" />
        </motion.button>
      )}

      <div
        ref={wrapRef}
        className="relative inline-block max-w-full max-h-[min(85vh,calc(100vh-10rem))]"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.img
          key={imageUrl}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15 }}
          src={imageUrl}
          className="block max-w-full max-h-[min(85vh,calc(100vh-10rem))] w-auto h-auto object-contain rounded-2xl shadow-2xl select-none"
          onLoad={() => {
            requestAnimationFrame(resizeCanvas);
          }}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full rounded-2xl touch-none ${
            drawMode ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 z-[210] flex flex-col items-center gap-3 pb-4 pt-2 bg-zinc-950/95 border-t border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-center gap-2 px-2">
          <button
            type="button"
            onClick={() => setDrawMode((d) => !d)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
              drawMode ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Pencil className="w-4 h-4" />
            {drawMode ? 'Рисовать: вкл' : 'Рисовать: выкл'}
          </button>
          <button
            type="button"
            onClick={clearCanvas}
            className="px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          >
            Очистить линии
          </button>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setStrokeColor(c.stroke)}
              className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 ${
                strokeColor === c.stroke ? 'scale-110 border-white' : 'border-transparent'
              } ${c.stroke === '#ffffff' ? 'ring-1 ring-zinc-500' : ''}`}
              style={{ backgroundColor: c.stroke }}
              aria-label={`Цвет ${c.id}`}
            />
          ))}
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
          Рисунок не сохраняется · ESC — закрыть
          {counterLabel ? ' · ← → соседние' : ''}
        </p>
      </div>
    </motion.div>
  );
}
