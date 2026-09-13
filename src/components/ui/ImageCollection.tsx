import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Image as ImageIcon } from "lucide-react";
import { ResultCard } from "../ResultCard";
import { Button } from "./Controls";
import "../../styles/collections.css";

export const COLLECTION_PAGE_SIZE = 24;
export interface ImageCollectionProps {
  kind: "history" | "favorites";
  images: string[];
  likedSet: Set<string>;
  toggleLike: (url: string) => void;
  handleUpscale: (url: string) => void;
  setFullscreenImage: (url: string) => void;
  onRefine: (url: string) => void;
  action?: React.ReactNode;
  extra?: (url: string) => React.ReactNode;
}
export function ImageCollection({
  kind,
  images,
  likedSet,
  toggleLike,
  handleUpscale,
  setFullscreenImage,
  onRefine,
  action,
  extra,
}: ImageCollectionProps) {
  const [requestedPage, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(images.length / COLLECTION_PAGE_SIZE));
  const page = Math.min(requestedPage, pages - 1);
  useEffect(() => setPage((current) => Math.min(current, pages - 1)), [pages]);
  const start = page * COLLECTION_PAGE_SIZE;
  const visible = images.slice(start, start + COLLECTION_PAGE_SIZE);
  return (
    <section
      className="studio-collection"
      data-collection={kind}
      aria-label={kind === "history" ? "История обложек" : "Избранные обложки"}
    >
      <div className="studio-collection__intro">
        <p>
          {kind === "history"
            ? "Ваши готовые обложки. Откройте изображение, чтобы рассмотреть детали или продолжить работу."
            : "Сохранённые обложки — для вдохновения и следующих работ."}
        </p>
        {action}
      </div>
      {images.length ? (
        <>
          <div className="studio-collection__toolbar">
            <span role="status" aria-live="polite">
              {start + 1}–
              {Math.min(start + COLLECTION_PAGE_SIZE, images.length)}{" "}
              <span>из {images.length}</span>
            </span>
            {pages > 1 && (
              <nav aria-label="Страницы обложек">
                <Button
                  aria-label="Предыдущая страница"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ArrowLeft size={16} />
                </Button>
                <span>
                  {page + 1} / {pages}
                </span>
                <Button
                  aria-label="Следующая страница"
                  disabled={page === pages - 1}
                  onClick={() => setPage(page + 1)}
                >
                  <ArrowRight size={16} />
                </Button>
              </nav>
            )}
          </div>
          <div className="studio-collection__grid">
            {visible.map((url, index) => (
              <div key={url} className="studio-collection__item">
                <ResultCard
                  url={url}
                  index={start + index + 1}
                  isLiked={likedSet.has(url)}
                  onToggleLike={toggleLike}
                  onUpscale={handleUpscale}
                  onFullscreen={setFullscreenImage}
                  onRefine={onRefine}
                  onDownload={downloadImage}
                />
                {extra?.(url)}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="studio-collection__empty">
          <ImageIcon size={28} aria-hidden="true" />
          <h2>
            {kind === "history"
              ? "Здесь появятся ваши обложки"
              : "Пока нет избранных обложек"}
          </h2>
          <p>
            {kind === "history"
              ? "Создайте изображение — сохранённый результат будет доступен здесь."
              : "Нажмите на сердечко у понравившегося изображения."}
          </p>
        </div>
      )}
    </section>
  );
}
function downloadImage(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "cover.png";
  anchor.click();
}
