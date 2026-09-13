import React, { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { clearHistory } from "../../services/serverStorageService";
import {
  ImageCollection,
  type ImageCollectionProps,
} from "../ui/ImageCollection";
import { Button } from "../ui/Controls";
type HistoryTabProps = Omit<
  ImageCollectionProps,
  "kind" | "images" | "extra" | "action"
> & {
  history: string[];
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
};
export function HistoryTab({ history, setHistory, ...props }: HistoryTabProps) {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const clear = async () => {
    if (clearing) return;
    setClearing(true);
    setError("");
    try {
      await clearHistory();
      setHistory([]);
    } catch {
      setError("Не удалось очистить историю. Попробуйте ещё раз.");
    } finally {
      setClearing(false);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="studio-collection__error">
          {error}
        </p>
      )}
      <ImageCollection
        {...props}
        kind="history"
        images={history}
        action={
          <Button
            variant="ghost"
            disabled={clearing || !history.length}
            onClick={clear}
          >
            {clearing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}{" "}
            Очистить историю
          </Button>
        }
      />
    </>
  );
}
