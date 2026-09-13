import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  ImagePlus,
  Loader2,
  Maximize2,
  Scan,
  Upload,
  X,
} from "lucide-react";
import {
  ASPECT_RATIOS,
  MODELS_SUPPORTING_IMAGE_SIZE,
  normalizeGeminiImageSettings,
  supportsGeminiAspectRatio,
  supportsGeminiImageSize,
} from "../../constants";
import { Button } from "../ui/Controls";
import { ModelPicker } from "../ui/ModelPicker";
import { imageToolModelOptions } from "../../features/models/options";
import type {
  ImageToolsController,
  ToolResult,
  ToolSettings,
} from "../../features/image-tools/useImageTools";
import "../../styles/image-tools.css";

const resultLabel = (item: ToolResult) =>
  item.operation === "expand"
    ? `Формат ${item.settings.aspectRatio}`
    : `Качество ${item.settings.imageSize}`;

export function ImageToolsTab({
  tools,
  available,
  onFullscreen,
  onRefine,
}: {
  tools: ImageToolsController;
  available: boolean;
  onFullscreen: (url: string) => void;
  onRefine: (url: string) => void;
}) {
  const { source, settings, operation, results, busy } = tools;
  const input = useRef<HTMLInputElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const readId = useRef(0);
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(
    Boolean(settings.prompt),
  );
  const selected = results.find((item) => item.id === selectedId) ?? results[0];
  const displayUrl =
    selected?.status === "done"
      ? showOriginal
        ? selected.source.data
        : selected.output
      : !selected
        ? source?.data
        : undefined;
  useEffect(() => {
    setShowOriginal(false);
  }, [selected?.id]);
  useEffect(
    () => () => {
      readId.current++;
    },
    [],
  );

  async function loadFile(file?: File) {
    if (!file) return;
    const id = ++readId.current;
    setUploadError(null);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setReading(false);
      setUploadError("Выберите JPG, PNG или WEBP размером до 10 МБ.");
      return;
    }
    setReading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
        reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("Файл не удалось открыть как изображение."));
        image.src = data;
      });
      if (readId.current !== id) return;
      tools.setSource({ data, mimeType: file.type, name: file.name });
    } catch (error) {
      if (readId.current === id)
        setUploadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить изображение.",
        );
    } finally {
      if (readId.current === id) setReading(false);
    }
  }

  const change = <K extends keyof ToolSettings>(
    key: K,
    value: ToolSettings[K],
  ) => tools.setSettings((previous) => ({ ...previous, [key]: value }));
  const action =
    operation === "expand"
      ? `Изменить формат · ${settings.aspectRatio}`
      : `Улучшить качество · ${settings.imageSize}`;

  return (
    <div className="image-tools">
      <p className="image-tools__intro">
        Расширьте кадр или улучшите детализацию. Исходник остаётся под рукой.
      </p>
      <div className="image-tools__layout">
        <div
          className="image-tools__controls"
          ref={controls}
          tabIndex={-1}
          aria-label="Параметры обработки"
        >
          <section aria-labelledby="tools-source-title">
            <div className="image-tools__section-title">
              <h2 id="tools-source-title">Изображение</h2>
              {source && (
                <Button
                  variant="ghost"
                  aria-label="Убрать изображение"
                  onClick={() => {
                    readId.current++;
                    setReading(false);
                    tools.setSource(null);
                    setUploadError(null);
                  }}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
            <div
              className={`image-tools__upload ${dragging ? "is-dragging" : ""}`}
              tabIndex={0}
              aria-label="Загрузите или вставьте изображение"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void loadFile(event.dataTransfer.files[0]);
              }}
              onPaste={(event) => {
                const file = Array.from(
                  event.clipboardData.items as DataTransferItemList,
                )
                  .find((item) => item.type.startsWith("image/"))
                  ?.getAsFile();
                if (file) {
                  event.preventDefault();
                  void loadFile(file);
                }
              }}
            >
              {source ? (
                <button
                  className="image-tools__source-image"
                  onClick={() => onFullscreen(source.data)}
                  aria-label="Открыть исходное изображение"
                >
                  <img
                    src={source.data}
                    alt={source.name ?? "Исходное изображение"}
                  />
                </button>
              ) : (
                <ImagePlus size={28} strokeWidth={1.5} aria-hidden="true" />
              )}
              <Button onClick={() => input.current?.click()}>
                <Upload size={16} aria-hidden="true" />
                {reading
                  ? "Загрузка…"
                  : source
                    ? "Заменить изображение"
                    : "Выбрать изображение"}
              </Button>
              <span>
                {source?.name ?? "Перетащите файл или вставьте из буфера"}
              </span>
            </div>
            <input
              ref={input}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              aria-label="Файл для обработки"
              onChange={(event) => {
                void loadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <p className="image-tools__hint">JPG, PNG, WEBP · до 10 МБ</p>
            {uploadError && (
              <p className="image-tools__error" role="alert">
                {uploadError}
              </p>
            )}
          </section>

          <section aria-labelledby="tools-operation-title">
            <h2 id="tools-operation-title">Что изменить</h2>
            <fieldset className="image-tools__switch" aria-label="Операция">
              <label>
                <input
                  type="radio"
                  name="image-operation"
                  value="expand"
                  checked={operation === "expand"}
                  onChange={() => tools.setOperation("expand")}
                />
                <span>
                  <Scan size={17} aria-hidden="true" />
                  Формат
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="image-operation"
                  value="upscale"
                  checked={operation === "upscale"}
                  onChange={() => tools.setOperation("upscale")}
                />
                <span>
                  <Maximize2 size={17} aria-hidden="true" />
                  Качество
                </span>
              </label>
            </fieldset>
            <p className="image-tools__description">
              {operation === "expand"
                ? "Дорисуем края под новый формат, без обрезки кадра."
                : "Увеличим разрешение и улучшим детали изображения."}
            </p>
            {operation === "expand" ? (
              <div className="image-tools__fields">
                <label htmlFor="tools-ratio">Соотношение сторон</label>
                <div
                  className="image-tools__ratios"
                  role="group"
                  aria-label="Популярные форматы"
                >
                  {(["16:9", "1:1", "9:16"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      disabled={!supportsGeminiAspectRatio(settings.model, ratio)}
                      onClick={() => supportsGeminiAspectRatio(settings.model, ratio) && change("aspectRatio", ratio)}
                      aria-pressed={settings.aspectRatio === ratio}
                    >
                      <span
                        className="image-tools__ratio-icon"
                        style={{ aspectRatio: ratio.replace(":", "/") }}
                        aria-hidden="true"
                      />
                      {ratio}
                    </button>
                  ))}
                </div>
                <select
                  id="tools-ratio"
                  value={settings.aspectRatio}
                  onChange={(event) =>
                    change(
                      "aspectRatio",
                      event.target.value as ToolSettings["aspectRatio"],
                    )
                  }
                >
                  {ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio} disabled={!supportsGeminiAspectRatio(settings.model, ratio)}>
                      {ratio}
                    </option>
                  ))}
                </select>
                <details
                  className="image-tools__prompt"
                  open={promptExpanded}
                  onToggle={(event) =>
                    setPromptExpanded(event.currentTarget.open)
                  }
                >
                  <summary>
                    Уточнить фон <span>Необязательно</span>
                  </summary>
                  <label htmlFor="tools-prompt">Что добавить по краям</label>
                  <textarea
                    id="tools-prompt"
                    rows={3}
                    value={settings.prompt}
                    placeholder="Например, продолжить фон и мягкое освещение"
                    onChange={(event) => change("prompt", event.target.value)}
                  />
                </details>
              </div>
            ) : (
              <div className="image-tools__fields">
                <label htmlFor="tools-size">Желаемое разрешение</label>
                <select
                  id="tools-size"
                  value={settings.imageSize}
                  onChange={(event) =>
                    change(
                      "imageSize",
                      event.target.value as ToolSettings["imageSize"],
                    )
                  }
                >
                  {["1K", "2K", "4K"].map((size) => (
                    <option key={size} disabled={!supportsGeminiImageSize(settings.model, size)}>{size}</option>
                  ))}
                </select>
                <p className="image-tools__hint">
                  Больше деталей — больше времени на обработку. Точный размер
                  результата зависит от модели.
                </p>
              </div>
            )}
          </section>

          <section aria-label="Модель обработки">
            <ModelPicker options={imageToolModelOptions} value={settings.model} onChange={model => {
              const normalized = normalizeGeminiImageSettings(model, settings.imageSize, settings.aspectRatio);
              tools.setSettings((previous) => ({ ...previous, model, ...normalized } as ToolSettings));
            }} />
            {operation === "upscale" && !MODELS_SUPPORTING_IMAGE_SIZE.has(settings.model) && (
              <p className="image-tools__hint">Эта модель не поддерживает точный выбор разрешения. Для управления размером выберите 3.1 Flash или 3 Pro.</p>
            )}
          </section>
          <div className="image-tools__submit">
            <Button
              variant="primary"
              disabled={!source || !available || busy || reading}
              onClick={() => {
                setSelectedId(null);
                setShowOriginal(false);
                void tools.run();
              }}
            >
              {busy ? (
                <Loader2
                  className="image-tools__spinner"
                  size={17}
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight size={17} aria-hidden="true" />
              )}
              {busy ? "Обрабатываем…" : action}
            </Button>
            <p className="image-tools__hint">
              {!source
                ? "Сначала добавьте изображение"
                : !available
                  ? "Обработка временно недоступна"
                  : "Создаётся новая версия. Исходник не изменится."}
            </p>
          </div>
        </div>

        <section
          className="image-tools__workspace"
          aria-labelledby="tools-result-title"
        >
          <div className="image-tools__result-heading">
            <h2 id="tools-result-title">
              {selected ? "Результаты" : "Предпросмотр"}
            </h2>
            {results.length > 0 && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Убрать результаты с этой страницы? Сохранённая история останется. Несохранённые версии сначала скачайте.",
                    )
                  )
                    tools.clearResults();
                }}
              >
                Очистить
              </Button>
            )}
          </div>
          {selected?.status === "done" && (
            <div
              className="image-tools__comparison"
              role="group"
              aria-label="Сравнение изображения"
            >
              <button
                aria-pressed={showOriginal}
                onClick={() => setShowOriginal(true)}
              >
                Исходник
              </button>
              <button
                aria-pressed={!showOriginal}
                onClick={() => setShowOriginal(false)}
              >
                Результат
              </button>
              <span>{resultLabel(selected)}</span>
            </div>
          )}
          <div
            className="image-tools__canvas"
            aria-busy={selected?.status === "loading"}
          >
            {displayUrl ? (
              <button
                className="image-tools__preview"
                onClick={() => onFullscreen(displayUrl)}
                aria-label={
                  selected
                    ? "Открыть изображение в полном размере"
                    : "Открыть предпросмотр"
                }
              >
                <img
                  src={displayUrl}
                  alt={
                    selected && !showOriginal
                      ? "Результат обработки"
                      : "Исходное изображение"
                  }
                />
              </button>
            ) : selected?.status === "loading" ? (
              <div className="image-tools__empty" role="status">
                <Loader2
                  size={26}
                  className="image-tools__spinner"
                  aria-hidden="true"
                />
                <h3>
                  {selected.operation === "expand"
                    ? "Расширяем кадр"
                    : "Улучшаем детали"}
                </h3>
                <p>{resultLabel(selected)} · можно перейти в другой раздел</p>
              </div>
            ) : selected?.status === "error" ? (
              <div className="image-tools__empty" role="alert">
                <h3>Не удалось обработать изображение</h3>
                <p className="image-tools__error">{selected.error}</p>
                <Button
                  disabled={busy || !available}
                  onClick={() => void tools.retry(selected.id)}
                >
                  Повторить обработку
                </Button>
              </div>
            ) : (
              <div className="image-tools__empty">
                <Scan size={28} strokeWidth={1.5} aria-hidden="true" />
                <h3>Изображение для обработки</h3>
                <p>
                  Добавьте изображение слева.
                  <br />
                  Здесь можно будет сравнить исходник и результат.
                </p>
              </div>
            )}
          </div>
          {selected?.status === "done" && selected.output && (
            <>
              <div className="image-tools__result-actions">
                <a
                  className="studio-button"
                  href={selected.output}
                  download={`cover-${selected.operation}-${selected.output.startsWith("data:image/webp") ? "result.webp" : selected.output.startsWith("data:image/jpeg") ? "result.jpg" : selected.output.startsWith("data:image/svg") ? "result.svg" : "result.png"}`}
                >
                  <Download size={16} aria-hidden="true" />
                  Скачать
                </a>
                <Button
                  onClick={() => {
                    readId.current++;
                    setReading(false);
                    setUploadError(null);
                    tools.useResult(selected.id);
                    controls.current?.scrollIntoView({
                      block: "start",
                      behavior: "smooth",
                    });
                    controls.current?.focus({ preventScroll: true });
                  }}
                >
                  <ArrowRight size={16} aria-hidden="true" />
                  {selected.operation === "expand"
                    ? "Дальше: улучшить качество"
                    : "Дальше: изменить формат"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => onRefine(selected.output!)}
                >
                  В редактор
                </Button>
              </div>
              {selected.warning && (
                <p className="image-tools__warning" role="status">
                  {selected.warning}
                </p>
              )}
            </>
          )}
          {results.length > 0 && (
            <div
              className="image-tools__versions"
              aria-label="Версии обработки"
            >
              {results.map((item, index) => (
                <button
                  key={item.id}
                  aria-pressed={item.id === selected?.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setShowOriginal(false);
                  }}
                >
                  <img src={item.output ?? item.source.data} alt="" />
                  <span>
                    <strong>{resultLabel(item)}</strong>
                    <small>
                      {item.status === "loading"
                        ? "Обработка…"
                        : item.status === "error"
                          ? "Ошибка · можно повторить"
                          : `Версия ${results.length - index}`}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
