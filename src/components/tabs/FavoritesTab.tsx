import React, { useRef, useState } from "react";
import { Loader2, FileText, X } from "lucide-react";
import {
  ImageCollection,
  type ImageCollectionProps,
} from "../ui/ImageCollection";
import { Button } from "../ui/Controls";
type FavoritesTabProps = Omit<
  ImageCollectionProps,
  "kind" | "images" | "extra" | "action"
> & {
  likedImages: string[];
  favoriteChoiceNotes: Record<string, string>;
  favoriteAnalysisLoadingUrl: string | null;
};
function formatFavoriteChoiceNote(raw: string): string {
  const cleaned = raw.replace(/\x60\x60\x60json\s*|\x60\x60\x60/gi, "").trim();
  try {
    const value = JSON.parse(cleaned) as {
      summary_ru?: string;
      likely_reasons_ru?: string[];
      vs_others_ru?: string;
    };
    if (value.summary_ru)
      return [
        value.summary_ru,
        ...(Array.isArray(value.likely_reasons_ru)
          ? value.likely_reasons_ru.map((reason) => `• ${reason}`)
          : []),
        value.vs_others_ru,
      ]
        .filter(Boolean)
        .join("\n\n");
  } catch {
    /* Preserve notes that are not structured JSON. */
  }
  return raw;
}
export function FavoritesTab({
  likedImages,
  favoriteChoiceNotes,
  favoriteAnalysisLoadingUrl,
  ...props
}: FavoritesTabProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  return (
    <>
      <ImageCollection
        {...props}
        kind="favorites"
        images={likedImages}
        extra={(url) => (
          <>
            {favoriteAnalysisLoadingUrl === url ? (
              <p className="studio-collection__note" role="status">
                <Loader2 size={15} className="animate-spin" /> Анализ выбора…
              </p>
            ) : favoriteChoiceNotes[url] ? (
              <button
                type="button"
                className="studio-collection__note"
                onClick={() => {
                  setNote(formatFavoriteChoiceNote(favoriteChoiceNotes[url]));
                  dialog.current?.showModal();
                }}
              >
                <FileText size={15} /> Почему этот кадр
              </button>
            ) : null}
          </>
        )}
      />
      <dialog
        ref={dialog}
        className="studio-collection-dialog"
        aria-labelledby="favorite-choice-note-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="studio-collection-dialog__body">
          <header>
            <h2 id="favorite-choice-note-title">Почему этот кадр</h2>
            <Button
              aria-label="Закрыть"
              variant="ghost"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </Button>
          </header>
          <p>{note}</p>
        </div>
      </dialog>
    </>
  );
}
