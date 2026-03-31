import React, { useCallback, useState } from 'react';
import { ZoomIn } from 'lucide-react';

/** Совместимо с префиксом fusion_ в IDB — единый масштаб превью на всех вкладках */
const STORAGE_KEY = 'fusion_result_preview_scale';

export const PREVIEW_SCALE_MIN = 60;
export const PREVIEW_SCALE_MAX = 130;
export const PREVIEW_SCALE_DEFAULT = 100;

export function clampPreviewScalePct(n: number): number {
  return Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, Math.round(n)));
}

export function pctToScale(pct: number): number {
  return Math.min(1.3, Math.max(0.6, pct / 100));
}

function readStoredPct(): number {
  if (typeof window === 'undefined') return PREVIEW_SCALE_DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return PREVIEW_SCALE_DEFAULT;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampPreviewScalePct(n) : PREVIEW_SCALE_DEFAULT;
  } catch {
    return PREVIEW_SCALE_DEFAULT;
  }
}

/**
 * Масштаб превью сеток (карточки результатов) — синхронизируется между вкладками через localStorage.
 */
export function useResultPreviewScaleFromStorage(): {
  pct: number;
  setPct: (n: number) => void;
  scale: number;
} {
  const [pct, setPctState] = useState(readStoredPct);
  const setPct = useCallback((n: number) => {
    const c = clampPreviewScalePct(n);
    setPctState(c);
    try {
      localStorage.setItem(STORAGE_KEY, String(c));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);
  const scale = pctToScale(pct);
  return { pct, setPct, scale };
}

export const PreviewScaleSlider: React.FC<{
  value: number;
  onChange: (pct: number) => void;
  className?: string;
}> = ({ value, onChange, className = '' }) => (
  <div
    className={`flex flex-col gap-2 rounded-2xl border border-white/5 bg-zinc-900/40 px-4 py-3 ${className}`}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <ZoomIn className="w-4 h-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
          Масштаб превью
        </span>
      </div>
      <span className="text-xs font-bold tabular-nums text-zinc-300 shrink-0">{value}%</span>
    </div>
    <input
      type="range"
      min={PREVIEW_SCALE_MIN}
      max={PREVIEW_SCALE_MAX}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-valuemin={PREVIEW_SCALE_MIN}
      aria-valuemax={PREVIEW_SCALE_MAX}
      aria-valuenow={value}
      aria-label="Масштаб превью карточек"
      className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
    />
  </div>
);

export const ScaledResultGrid: React.FC<{
  scale: number;
  children: React.ReactNode;
  className?: string;
}> = ({ scale, children, className = '' }) => (
  <div
    className={`mx-auto w-full transition-[transform,width] duration-200 ease-out will-change-transform ${className}`}
    style={{
      width: `${100 / scale}%`,
      transform: `scale(${scale})`,
      transformOrigin: 'top center',
    }}
  >
    {children}
  </div>
);
