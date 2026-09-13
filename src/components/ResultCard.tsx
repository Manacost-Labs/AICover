import React from "react";
import { Heart, Download, Maximize2, RefreshCw } from "lucide-react";
import { OptimizedImage } from "./OptimizedImage";
interface ResultCardProps {
  url: string;
  index: number;
  isLiked: boolean;
  onToggleLike: (url: string) => void;
  onUpscale: (url: string) => void;
  onFullscreen: (url: string) => void;
  onRefine: (url: string) => void;
  onDownload: (url: string) => void;
}
export const ResultCard = React.memo(function ResultCard({
  url,
  index,
  isLiked,
  onToggleLike,
  onUpscale,
  onFullscreen,
  onRefine,
  onDownload,
}: ResultCardProps) {
  return (
    <article className="studio-result-card">
      <button
        type="button"
        className="studio-result-card__preview"
        aria-label={`Открыть обложку ${index}`}
        onClick={() => onFullscreen(url)}
      >
        <OptimizedImage
          src={url}
          alt={`Обложка ${index}`}
          width={960}
          height={600}
          className="studio-result-card__image"
          referrerPolicy="no-referrer"
        />
      </button>
      <div className="studio-result-card__actions">
        <button
          type="button"
          aria-label={isLiked ? "Убрать из избранного" : "В избранное"}
          aria-pressed={isLiked}
          onClick={() => onToggleLike(url)}
          title={isLiked ? "Убрать из избранного" : "В избранное"}
        >
          <Heart size={17} fill={isLiked ? "currentColor" : "none"} />
        </button>
        <span className="studio-result-card__number">
          {String(index).padStart(2, "0")}
        </span>
        <button
          type="button"
          aria-label="Улучшить качество"
          title="Улучшить качество"
          onClick={() => onUpscale(url)}
        >
          <Maximize2 size={17} />
        </button>
        <button
          type="button"
          aria-label="Использовать как основу"
          title="Использовать как основу"
          onClick={() => onRefine(url)}
        >
          <RefreshCw size={17} />
        </button>
        <button
          type="button"
          aria-label="Скачать обложку"
          title="Скачать обложку"
          onClick={() => onDownload(url)}
        >
          <Download size={17} />
        </button>
      </div>
    </article>
  );
});
