import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface CollapsibleSectionProps {
  title: string;
  /** Подзаголовок под кнопкой (виден всегда) */
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Доп. классы для кнопки-заголовка */
  triggerClassName?: string;
}

/**
 * Доступный «спойлер»: плавное раскрытие через grid 0fr/1fr (без лишних измерений layout).
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  description,
  defaultOpen = false,
  children,
  className = '',
  triggerClassName = '',
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId().replace(/:/g, '');
  const contentId = `collapsible-content-${baseId}`;
  const headerId = `collapsible-header-${baseId}`;

  return (
    <div className={className}>
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left transition-colors hover:border-white/15 hover:bg-black/30 ${triggerClassName}`}
      >
        <span className="min-w-0">
          <span className="block text-xs font-black uppercase tracking-widest text-zinc-300">{title}</span>
          {description ? (
            <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{description}</span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      <div
        id={contentId}
        role="region"
        aria-labelledby={headerId}
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
};
