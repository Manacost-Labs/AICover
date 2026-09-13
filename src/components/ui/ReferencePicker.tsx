import React, { useEffect, useRef, useState } from "react";
import { Images, Upload, Search, X, Check, Loader2 } from "lucide-react";
import type { ReferenceLibraryEntry } from "../../services/serverStorageService";
import type { ImageSource } from "../../services/geminiService";
import { OptimizedImage } from "../OptimizedImage";
import { Button } from "./Controls";
import "../../styles/references.css";

interface ReferencePickerProps {
  reference: ImageSource | null;
  entries: ReferenceLibraryEntry[];
  onSelect: (
    entry: ReferenceLibraryEntry,
    signal?: AbortSignal,
  ) => void | Promise<void>;
  onUpload: () => void;
  onClear: () => void;
  onPreview: (url: string) => void;
}

export function ReferencePicker({
  reference,
  entries,
  onSelect,
  onUpload,
  onClear,
  onPreview,
}: ReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selection = useRef<AbortController | null>(null);
  useEffect(() => () => selection.current?.abort(), []);
  const cancel = () => {
    selection.current?.abort();
    selection.current = null;
    setPending(null);
    setOpen(false);
    setError("");
  };
  const visible = entries.filter((entry) =>
    entry.name
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru")),
  );
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      search.current?.focus();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  const choose = async (entry: ReferenceLibraryEntry) => {
    if (selection.current) return;
    const controller = new AbortController();
    selection.current = controller;
    setPending(entry.id);
    setError("");
    try {
      await onSelect(entry, controller.signal);
      if (!controller.signal.aborted) setOpen(false);
    } catch {
      if (!controller.signal.aborted)
        setError("Не удалось выбрать референс. Попробуйте ещё раз.");
    } finally {
      if (selection.current === controller) {
        selection.current = null;
        setPending(null);
      }
    }
  };
  return (
    <div className="studio-reference-picker">
      {reference ? (
        <div className="studio-reference-selected">
          <button
            type="button"
            className="studio-reference-selected__image"
            onClick={() => onPreview(reference.data)}
            aria-label="Открыть выбранный референс"
          >
            <OptimizedImage
              src={reference.data}
              alt="Выбранная композиция"
              priority
            />
          </button>
          <div>
            <strong>Композиция выбрана</strong>
            <span>Ориентир для расположения персонажей</span>
            <Button variant="ghost" disabled={!!pending} onClick={onClear}>
              Убрать референс
            </Button>
          </div>
          <Check size={16} aria-hidden="true" />
        </div>
      ) : (
        <p className="studio-reference-description">
          Покажите, как расположить персонажей в кадре.
        </p>
      )}
      <div className="studio-reference-actions">
        <Button disabled={!!pending} onClick={onUpload}>
          <Upload size={16} aria-hidden="true" />
          {reference ? "Заменить файлом" : "Загрузить файл"}
        </Button>
        <Button
          ref={trigger}
          disabled={!!pending}
          aria-haspopup="dialog"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          <Images size={16} aria-hidden="true" />
          Сохранённые{" "}
          <span className="studio-reference-count">{entries.length}</span>
        </Button>
      </div>
      <dialog
        ref={dialog}
        className="studio-reference-dialog"
        aria-labelledby="reference-dialog-title"
        onCancel={cancel}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="studio-reference-dialog__header">
          <div>
            <h2 id="reference-dialog-title">Выберите композицию</h2>
            <p>Референс задаёт расположение, а не внешность персонажей.</p>
          </div>
          <Button
            variant="ghost"
            onClick={cancel}
            aria-label="Закрыть выбор референса"
          >
            <X size={20} />
          </Button>
        </div>
        <label className="studio-reference-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по названию"
            aria-label="Поиск сохранённых референсов"
          />
        </label>
        <p className="studio-reference-description" aria-live="polite">
          {visible.length} из {entries.length} референсов
        </p>
        <div className="studio-reference-grid">
          {visible.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="studio-reference-choice"
              disabled={!!pending}
              onClick={() => void choose(entry)}
              aria-label={`Выбрать ${entry.name}`}
            >
              <OptimizedImage
                src={entry.storageUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
              <span title={entry.name}>
                {pending === entry.id && (
                  <Loader2 size={14} className="studio-create__spin" />
                )}
                {entry.name}
              </span>
            </button>
          ))}
        </div>
        {!visible.length && (
          <div className="studio-reference-empty">
            <Images size={24} />
            <strong>
              {entries.length
                ? "Ничего не найдено"
                : "Пока нет сохранённых референсов"}
            </strong>
            <p>
              {entries.length
                ? "Попробуйте другое название."
                : "Загрузите файл для этой обложки или добавьте композицию в разделе «Референсы»."}
            </p>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {pending && <p role="status">Загружаем выбранную композицию…</p>}
        <div className="studio-reference-dialog__footer">
          <Button
            disabled={!!pending}
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
          >
            <Upload size={16} />
            Загрузить свой файл
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Отмена
          </Button>
        </div>
      </dialog>
    </div>
  );
}
