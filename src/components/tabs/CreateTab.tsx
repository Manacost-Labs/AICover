import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Download,
  Expand,
  Heart,
  ImageIcon,
  Layout,
  Loader2,
  Maximize2,
  Plus,
  Settings,
  Upload,
  X,
} from "lucide-react";
import type {
  CoverGenerationProgress,
  SceneRole,
} from "../../services/geminiService";
import { sceneRolesOrder } from "../../services/geminiService";
import { DeckImportSection } from "../DeckImportSection";
import { OptimizedImage } from "../OptimizedImage";
import type {
  CardLibraryEntry,
  ReferenceLibraryEntry,
} from "../../services/serverStorageService";
import {
  getGeminiImageCapabilities,
  normalizeGeminiImageSettings,
  supportsGeminiAspectRatio,
  supportsGeminiImageSize,
} from "../../constants";
import { Button } from "../ui/Controls";
import { ReferencePicker } from "../ui/ReferencePicker";
import { ProviderModelPicker as ModelPicker, ChatGptImageNotice, OpenRouterImageNotice, useOpenRouterModelAvailability } from "../ui/ChatGptConnection";
import { generationModelOptions } from "../../features/models/options";
import { getOpenRouterModel, isOpenRouterImageModel, normalizeOpenRouterSettings } from "../../services/openRouterImages";
import "../../styles/create.css";

interface CreateTabProps {
  sources: any[];
  setSources: React.Dispatch<React.SetStateAction<any[]>>;
  createLayoutMode: "cover" | "scene";
  onCreateLayoutModeChange: (mode: "cover" | "scene") => void;
  scenePlan: 2 | 3;
  onScenePlanChange: (plan: 2 | 3) => void;
  focusedSceneSlot: SceneRole;
  onFocusedSceneSlotChange: (slot: SceneRole) => void;
  onRequestSourceUploadForSlot: (slot: SceneRole) => void;
  reference: { data: string; mimeType: string } | null;
  setReference: (ref: { data: string; mimeType: string } | null) => void;
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  baseImage: { data: string; mimeType: string } | null;
  setBaseImage: (image: { data: string; mimeType: string } | null) => void;
  isGenerating: boolean;
  handleGenerate: () => Promise<void>;
  generationProgress: CoverGenerationProgress | null;
  onCancelGeneration: () => void;
  sceneToCoverWarning: boolean;
  results: string[];
  isUpscaling: boolean;
  handleUpscale: (url: string, existingId?: string) => Promise<void>;
  setFullscreenImage: (url: string | null) => void;
  toggleLike: (url: string) => Promise<void>;
  likedSet: Set<string>;
  error: string | null;
  isDragging: boolean;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: () => void;
  handleDrop: (e: React.DragEvent) => void;
  handleLocalPaste: (
    e: React.ClipboardEvent,
    type: "source" | "reference",
  ) => void;
  sourceInputRef: React.RefObject<HTMLInputElement | null>;
  refInputRef: React.RefObject<HTMLInputElement | null>;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  handleFileChange: (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "source" | "reference",
  ) => void;
  handleDragOverRef: (e: React.DragEvent) => void;
  handleDragLeaveRef: () => void;
  handleDropRef: (e: React.DragEvent) => void;
  selectReferenceFromLibrary: (entry: ReferenceLibraryEntry, signal?: AbortSignal) => Promise<void>;
  ASPECT_RATIOS: string[];
  RESOLUTIONS: string[];
  isDraggingRef: boolean;
  userReferenceLibrary: ReferenceLibraryEntry[];
  cardLibrary: CardLibraryEntry[];
  onAddCardSource: (entry: CardLibraryEntry) => void;
  onRemoveCardSource: (sourceId: string) => void;
  availability?: "checking" | "available" | "unavailable";
  onRetryAvailability?: () => void;
  onOpenSettings?: () => void;
  saveWarning?: string | null;
  generationNotice?: string | null;
  openRouterEnabled?: boolean;
}
const SCENE_DRAG_MIME = "application/x-manacost-scene-role";
const label = (role: SceneRole) =>
  role === "left" ? "Лево" : role === "center" ? "Центр" : "Право";
function swap(
  items: { id: string; role?: SceneRole }[],
  from: SceneRole,
  to: SceneRole,
) {
  const a = items.find((x) => x.role === from),
    b = items.find((x) => x.role === to);
  if (!a) return items;
  return items.map((x) =>
    x.id === a.id
      ? { ...x, role: to }
      : b && x.id === b.id
        ? { ...x, role: from }
        : x,
  );
}
function download(url: string, index: number) {
  const a = document.createElement("a");
  a.href = url;
  a.download = `cover-${index + 1}.png`;
  a.click();
}

const progressSteps = [
  { id: 'preparing', label: 'Подготовка' },
  { id: 'generating', label: 'Создание' },
  { id: 'finalizing', label: 'Финализация' },
] as const;

function imageSource(source: any) {
  return typeof source?.data === 'string' && source.data.startsWith('data:')
    ? source.data
    : `data:${source?.mimeType || 'image/png'};base64,${source?.data || ''}`;
}

function GenerationStage({
  progress,
  sources,
  aspectRatio,
  modelName,
  onCancel,
}: {
  progress: CoverGenerationProgress | null;
  sources: any[];
  aspectRatio: string;
  modelName: string;
  onCancel: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const phase = progress?.phase === 'strict' ? 'finalizing' : progress?.phase || 'preparing';
  const activeIndex = progressSteps.findIndex(step => step.id === phase);
  const status = phase === 'preparing'
    ? 'Собираем исходники без обрезки'
    : phase === 'finalizing'
      ? 'Проверяем и сохраняем результат'
      : 'Модель выстраивает композицию';
  const ratio = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(aspectRatio) ? aspectRatio.replace(':', ' / ') : '16 / 9';
  return (
    <motion.div
      className="studio-generation"
      data-generation-stage={phase}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      aria-live="polite"
    >
      <div className="studio-generation__visual" style={{ aspectRatio: ratio }}>
        <div className="studio-generation__sources" aria-hidden="true">
          {sources.slice(0, 3).map((source, index) => (
            <motion.img
              src={imageSource(source)}
              alt=""
              key={source.id || index}
              initial={reducedMotion ? false : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reducedMotion ? 0 : index * 0.08, duration: 0.24 }}
            />
          ))}
        </div>
        <div className="studio-generation__output" aria-hidden="true">
          <ImageIcon size={26} strokeWidth={1.5} />
          {phase === 'generating' && <span className="studio-generation__scan" />}
        </div>
      </div>
      <div className="studio-generation__status">
        <div>
          <strong>{status}</strong>
          <span>{modelName}{progress && progress.total > 1 ? ` · ${progress.done} из ${progress.total}` : ''}</span>
        </div>
        <ol aria-label="Этапы генерации">
          {progressSteps.map((step, index) => (
            <li key={step.id} className={index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : ''}>
              <span>{index + 1}</span>{step.label}
            </li>
          ))}
        </ol>
        <button type="button" onClick={onCancel}>Остановить ожидание</button>
        <small>Отправленная операция может продолжиться у провайдера.</small>
      </div>
    </motion.div>
  );
}

export const CreateTab: React.FC<CreateTabProps> = ({
  sources,
  setSources,
  createLayoutMode,
  onCreateLayoutModeChange,
  scenePlan,
  onScenePlanChange,
  focusedSceneSlot,
  onFocusedSceneSlotChange,
  onRequestSourceUploadForSlot,
  reference,
  setReference,
  settings,
  setSettings,
  baseImage,
  setBaseImage,
  isGenerating,
  handleGenerate,
  generationProgress,
  onCancelGeneration,
  sceneToCoverWarning,
  results,
  isUpscaling,
  handleUpscale,
  setFullscreenImage,
  toggleLike,
  likedSet,
  error,
  isDragging,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleLocalPaste,
  sourceInputRef,
  refInputRef,
  promptRef,
  handleFileChange,
  handleDragOverRef,
  handleDragLeaveRef,
  handleDropRef,
  selectReferenceFromLibrary,
  ASPECT_RATIOS,
  RESOLUTIONS,
  isDraggingRef,
  userReferenceLibrary,
  cardLibrary,
  onAddCardSource,
  onRemoveCardSource,
  availability = "available",
  onRetryAvailability,
  onOpenSettings,
  saveWarning,
  generationNotice,
  openRouterEnabled = false,
}) => {
  const [advanced, setAdvanced] = React.useState(false);
  const [dragRole, setDragRole] = React.useState<SceneRole | null>(null);
  const modelAvailability = useOpenRouterModelAvailability();
  const roles = sceneRolesOrder(scenePlan);
  const filled = roles.filter((r) => sources.some((s) => s.role === r)).length;
  const valid =
    createLayoutMode === "cover" ? sources.length >= 2 : filled === scenePlan;
  const openRouterModel = getOpenRouterModel(settings.model);
  const geminiCapabilities = getGeminiImageCapabilities(settings.model);
  const requiredReferenceCount = sources.length + Number(Boolean(reference)) + Number(Boolean(baseImage));
  const automaticImageSize = settings.model === 'gpt-image-2'
    || Boolean(openRouterModel && openRouterModel.resolutions.length === 0);
  const reason = isUpscaling
    ? "Дождитесь завершения апскейла."
    : settings.model === 'gpt-image-2' && sources.length + Number(Boolean(reference)) + Number(Boolean(baseImage)) > 5
      ? 'GPT Image 2 принимает до 5 изображений вместе с референсом и основой. Уберите лишний исходник.'
    : openRouterModel && modelAvailability[openRouterModel.id] === 'unavailable'
      ? `У ${openRouterModel.name} сейчас нет активного endpoint OpenRouter. Выберите другую модель.`
    : openRouterModel && openRouterModel.referenceStrategy !== 'contact-sheet' && requiredReferenceCount > openRouterModel.maxReferences
      ? `${openRouterModel.name} принимает до ${openRouterModel.maxReferences} изображений вместе с референсом и основой.`
    : availability === "checking"
      ? "Проверяем доступность генерации."
      : availability === "unavailable"
        ? "Генерация сейчас недоступна. Проверьте настройки и повторите проверку."
        : !valid
          ? createLayoutMode === "cover"
            ? sources.length === 0
              ? "Добавьте минимум два изображения."
              : "Добавьте ещё одно изображение."
            : "Заполните все обязательные роли сцены."
          : null;
  const setMode = (mode: "cover" | "scene") => {
    if (
      mode === "scene" &&
      sources.length > scenePlan &&
      !window.confirm(
        "В сцене останутся только первые " +
          scenePlan +
          " изображения. Продолжить?",
      )
    )
      return;
    onCreateLayoutModeChange(mode);
  };
  const plan = (value: 2 | 3) => {
    if (value === scenePlan) return;
    if (
      value === 2 &&
      sources.some((s) => s.role === "center") &&
      !window.confirm(
        "Центральное изображение будет удалено из сцены. Продолжить?",
      )
    )
      return;
    onScenePlanChange(value);
  };
  const move = (from: SceneRole, direction: -1 | 1) => {
    const to = roles[roles.indexOf(from) + direction];
    if (to) {
      setSources((all) => swap(all, from, to));
      onFocusedSceneSlotChange(to);
    }
  };
  const refine = (url: string) => {
    setBaseImage({ data: url, mimeType: "image/png" });
    window.setTimeout(() => promptRef.current?.focus(), 0);
  };
  return (
    <div className="studio-create" aria-label="Редактор создания обложки">
      <div className="studio-create__rail">
        <div
          className="studio-create__modes"
          role="radiogroup"
          aria-label="Тип композиции"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const next = createLayoutMode === "cover" ? "scene" : "cover";
              setMode(next);
              const group = e.currentTarget as HTMLDivElement;
              group
                .querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)
                ?.focus();
            }
          }}
        >
          {(["cover", "scene"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              data-mode={mode}
              tabIndex={createLayoutMode === mode ? 0 : -1}
              aria-checked={createLayoutMode === mode}
              className="studio-create__segment"
              onClick={() => setMode(mode)}
            >
              {mode === "cover" ? (
                <ImageIcon size={16} />
              ) : (
                <Layout size={16} />
              )}
              {mode === "cover" ? "Обложка" : "Сцена"}
            </button>
          ))}
        </div>
        {sceneToCoverWarning && (
          <p
            className="studio-create__notice studio-create__notice--warning"
            role="status"
          >
            Роли слотов сброшены, изображения сохранены.
          </p>
        )}
        <section
          className="studio-create__section"
          aria-labelledby="create-sources"
        >
          <div className="studio-create__section-heading">
            <h2 id="create-sources">
              Исходники{" "}
              {createLayoutMode === "cover"
                ? `${sources.length}/4`
                : `${filled}/${scenePlan}`}
            </h2>
            {sources.length > 0 && (
              <button
                type="button"
                className="studio-create__text-action"
                onClick={() => setSources([])}
              >
                Очистить
              </button>
            )}
          </div>
          {createLayoutMode === "scene" && (
            <div className="studio-create__plan">
              <button
                type="button"
                className={scenePlan === 2 ? "is-selected" : ""}
                onClick={() => plan(2)}
              >
                2 персонажа
              </button>
              <button
                type="button"
                className={scenePlan === 3 ? "is-selected" : ""}
                onClick={() => plan(3)}
              >
                3 персонажа
              </button>
            </div>
          )}
          <div
            className={`studio-create__sources studio-create__sources--${createLayoutMode} ${isDragging ? "is-dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={(e) => handleLocalPaste(e, "source")}
            tabIndex={0}
          >
            {createLayoutMode === "cover"
              ? sources.map(
                  (source: { id: string; data: string }, index: number) => (
                    <article className="studio-create__source" key={source.id}>
                      <button
                        type="button"
                        className="studio-create__media-button"
                        onClick={() => setFullscreenImage(source.data)}
                        aria-label={`Открыть исходник ${index + 1}`}
                      >
                        <OptimizedImage
                          src={source.data}
                          alt={`Исходник ${index + 1}`}
                          className="studio-create__image"
                          referrerPolicy="no-referrer"
                          priority
                        />
                      </button>
                      <span className="studio-create__source-label">
                        {index + 1}
                      </span>
                      <div className="studio-create__cover-move">
                        <button
                          type="button"
                          disabled={index === 0}
                          aria-label={`Переместить исходник ${index + 1} влево`}
                          onClick={() =>
                            setSources((all) => {
                              const next = [...all];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              return next;
                            })
                          }
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          disabled={index === sources.length - 1}
                          aria-label={`Переместить исходник ${index + 1} вправо`}
                          onClick={() =>
                            setSources((all) => {
                              const next = [...all];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index],
                              ];
                              return next;
                            })
                          }
                        >
                          →
                        </button>
                      </div>
                      <button
                        type="button"
                        className="studio-create__remove"
                        onClick={() =>
                          setSources((all) =>
                            all.filter((x) => x.id !== source.id),
                          )
                        }
                        aria-label={`Удалить исходник ${index + 1}`}
                      >
                        <X size={16} />
                      </button>
                    </article>
                  ),
                )
              : roles.map((role, index) => {
                  const source = sources.find((s) => s.role === role);
                  const over = dragRole === role;
                  const drag = (e: React.DragEvent) => {
                    if (
                      Array.from(e.dataTransfer.types).includes(SCENE_DRAG_MIME)
                    ) {
                      e.preventDefault();
                      setDragRole(role);
                    }
                  };
                  const drop = (e: React.DragEvent) => {
                    if (
                      !Array.from(e.dataTransfer.types).includes(
                        SCENE_DRAG_MIME,
                      )
                    )
                      return;
                    e.preventDefault();
                    setDragRole(null);
                    const from = e.dataTransfer.getData(
                      SCENE_DRAG_MIME,
                    ) as SceneRole;
                    if (from && from !== role)
                      setSources((all) => swap(all, from, role));
                    onFocusedSceneSlotChange(role);
                  };
                  return (
                    <article
                      key={role}
                      className={`studio-create__scene-slot ${focusedSceneSlot === role ? "is-focused" : ""} ${over ? "is-dragging" : ""}`}
                      onDragOver={drag}
                      onDrop={drop}
                    >
                      <div className="studio-create__slot-heading">
                        <button
                          type="button"
                          onClick={() => onFocusedSceneSlotChange(role)}
                        >
                          {label(role)}
                        </button>
                        {source && (
                          <span className="studio-create__slot-move">
                            <button
                              type="button"
                              disabled={!index}
                              onClick={() => move(role, -1)}
                              aria-label={`Переместить ${label(role)} влево`}
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              disabled={index === roles.length - 1}
                              onClick={() => move(role, 1)}
                              aria-label={`Переместить ${label(role)} вправо`}
                            >
                              →
                            </button>
                            <button
                              type="button"
                              className="studio-create__slot-remove"
                              onClick={() => setSources((all) => all.filter((x) => x.id !== source.id))}
                              aria-label={`Удалить ${label(role)}`}
                            >
                              <X size={16} />
                            </button>
                          </span>
                        )}
                      </div>
                      {source ? (
                        <>
                          <button
                            type="button"
                            draggable
                            className="studio-create__media-button"
                            onDragStart={(e) =>
                              e.dataTransfer.setData(SCENE_DRAG_MIME, role)
                            }
                            onDragEnd={() => setDragRole(null)}
                            onClick={() => setFullscreenImage(source.data)}
                            aria-label={`Открыть слот ${label(role)}`}
                          >
                            <OptimizedImage
                              src={source.data}
                              alt={`Слот ${label(role)}`}
                              className="studio-create__image"
                              referrerPolicy="no-referrer"
                              priority
                              draggable={false}
                            />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="studio-create__add-source"
                          onClick={() => onRequestSourceUploadForSlot(role)}
                        >
                          <Plus size={18} />
                          Добавить
                        </button>
                      )}
                    </article>
                  );
                })}
            {createLayoutMode === "cover" && sources.length < 4 && (
              <button
                type="button"
                className="studio-create__add-source"
                onClick={() => sourceInputRef.current?.click()}
              >
                <Plus size={18} />
                Добавить
              </button>
            )}
          </div>
          <p className="studio-create__helper">
            {createLayoutMode === "scene"
              ? "Выберите роль, затем загрузите файл. Перетаскивайте или меняйте слот кнопками."
              : "Перетащите файл сюда, вставьте из буфера или добавьте изображение."}
          </p>
          <input
            ref={sourceInputRef}
            type="file"
            hidden
            multiple={createLayoutMode === "cover"}
            accept="image/*"
            onChange={(e) => handleFileChange(e, "source")}
          />
        </section>
        <section
          className="studio-create__section studio-create__reference-section"
          aria-labelledby="create-reference-title"
        >
          <div className="studio-create__section-heading">
            <h2 id="create-reference-title">Референс композиции</h2>
            <span>Необязательно</span>
          </div>
          <div
            className={
              isDraggingRef
                ? "studio-create__reference-drop is-dragging"
                : "studio-create__reference-drop"
            }
            onDragOver={handleDragOverRef}
            onDragLeave={handleDragLeaveRef}
            onDrop={handleDropRef}
            onPaste={(e) => handleLocalPaste(e, "reference")}
            tabIndex={0}
            aria-label="Загрузить референс перетаскиванием или вставкой"
          >
            <ReferencePicker
              reference={reference}
              entries={userReferenceLibrary}
              onSelect={selectReferenceFromLibrary}
              onUpload={() => refInputRef.current?.click()}
              onClear={() => setReference(null)}
              onPreview={setFullscreenImage}
            />
          </div>
          <input
            ref={refInputRef}
            type="file"
            hidden
            accept="image/*"
            aria-label="Файл референса"
            onChange={(e) => handleFileChange(e, "reference")}
          />
        </section>
        <section
          className="studio-create__section"
          aria-labelledby="create-settings"
        >
          <div className="studio-create__section-heading">
            <h2 id="create-settings">Параметры</h2>
          </div>
          <label className="studio-create__field">
            <span id="create-prompt-label">
              {baseImage ? "Инструкции по доработке" : "Промпт"}
            </span>
            <textarea
              aria-labelledby="create-prompt-label"
              ref={promptRef}
              value={settings.prompt}
              onChange={(e) =>
                setSettings((s: any) => ({ ...s, prompt: e.target.value }))
              }
              placeholder={
                baseImage
                  ? "Опишите, что изменить или добавить"
                  : "Опишите будущую обложку"
              }
            />
          </label>
          {baseImage && (
            <div className="studio-create__base">
              <button
                type="button"
                onClick={() => setFullscreenImage(baseImage.data)}
              >
                <OptimizedImage
                  src={baseImage.data}
                  alt="Основа для доработки"
                  className="studio-create__image"
                />
              </button>
              <span>Доработка изображения</span>
              <button
                type="button"
                onClick={() => setBaseImage(null)}
                aria-label="Убрать основу"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="studio-create__model">
            <ModelPicker options={generationModelOptions} value={settings.model} disabled={isGenerating || isUpscaling} openRouterEnabled={openRouterEnabled}
              onChange={model => setSettings((s: any) => {
                const openRouterSettings = normalizeOpenRouterSettings(model, s.imageSize, s.aspectRatio);
                const normalized = normalizeGeminiImageSettings(model, openRouterSettings.imageSize, openRouterSettings.aspectRatio);
                return {
                  ...s,
                  model,
                  ...normalized,
                };
              })}
            />
          </div>
          {settings.model === 'gpt-image-2' && <ChatGptImageNotice />}
          {isOpenRouterImageModel(settings.model) && <OpenRouterImageNotice modelId={settings.model} />}
          <div className="studio-create__choice-row">
            <label className="studio-create__field">
              <span>Формат</span>
              <select
                value={settings.aspectRatio}
                onChange={(e) =>
                  setSettings((value: any) => ({
                    ...value,
                    aspectRatio: e.target.value,
                  }))
                }
              >
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio} disabled={
                    !supportsGeminiAspectRatio(settings.model, ratio)
                    || Boolean(openRouterModel && openRouterModel.aspectRatios.length > 0 && !(openRouterModel.aspectRatios as readonly string[]).includes(ratio))
                  }>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-create__field">
              <span>Размер</span>
              <select
                value={automaticImageSize ? 'auto' : settings.imageSize}
                disabled={automaticImageSize}
                onChange={(e) =>
                  setSettings((value: any) => ({
                    ...value,
                    imageSize: e.target.value,
                  }))
                }
              >
                {automaticImageSize && <option value="auto">Автоматически</option>}
                {RESOLUTIONS.map((resolution) => (
                  <option
                    key={resolution}
                    value={resolution}
                    disabled={
                      !supportsGeminiImageSize(settings.model, resolution)
                      || Boolean(openRouterModel && openRouterModel.resolutions.length > 0 && !(openRouterModel.resolutions as readonly string[]).includes(resolution))
                    }
                  >
                    {resolution}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {geminiCapabilities && geminiCapabilities.resolutions.length < RESOLUTIONS.length && (
            <p className="studio-create__helper">
              Доступные размеры: {geminiCapabilities.resolutions.join(", ")}.
            </p>
          )}
          <label className="studio-create__field">
            <span>Варианты: {settings.batchSize}</span>
            <input
              type="range"
              min="1"
              max="4"
              value={settings.batchSize}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  batchSize: Number(e.target.value),
                }))
              }
            />
          </label>
          <button
            type="button"
            className="studio-create__advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced((x) => !x)}
          >
            <Settings size={16} />
            Дополнительно{" "}
            {(settings.strictMode || settings.negativePrompt) && (
              <small title="Дополнительные параметры включены">Вкл.</small>
            )}
            <span>{advanced ? "−" : "+"}</span>
          </button>
          {advanced && (
            <div className="studio-create__advanced">
              {onOpenSettings && (
                <Button variant="ghost" onClick={onOpenSettings}>
                  Системный промпт
                </Button>
              )}
              <label className="studio-create__field">
                <span>Отрицательный промпт</span>
                <input
                  value={settings.negativePrompt}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      negativePrompt: e.target.value,
                    }))
                  }
                  placeholder="Например, текст или размытость"
                />
              </label>
              <label className="studio-create__switch">
                <span>
                  <strong>Максимальная точность</strong>
                  <small>Проверить исходники и результат.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.model !== 'gpt-image-2' && settings.strictMode}
                  disabled={settings.model === 'gpt-image-2'}
                  onChange={() =>
                    setSettings((s: any) => ({
                      ...s,
                      strictMode: !s.strictMode,
                    }))
                  }
                />
              </label>
            </div>
          )}
        </section>
        <div className="studio-create__rail-footer">
          {reason && (
            <p className="studio-create__disabled-reason" role="status">
              {reason}{" "}
              {availability === "unavailable" && onRetryAvailability && (
                <button type="button" onClick={onRetryAvailability}>
                  Повторить
                </button>
              )}
            </p>
          )}
          <button
            type="button"
            className="studio-create__generate"
            disabled={!!reason || isGenerating}
            onClick={() => void handleGenerate()}
          >
            {isGenerating ? (
              <Loader2 size={18} className="studio-create__spin" />
            ) : (
              <ImageIcon size={18} />
            )}
            {isGenerating
              ? "Создаём варианты"
              : `Создать ${settings.batchSize} ${settings.batchSize === 1 ? "вариант" : "варианта"}`}
          </button>
        </div>
      </div>
      <section
        className="studio-create__canvas"
        aria-labelledby="create-results"
      >
        <div className="studio-create__canvas-heading">
          <h2 id="create-results">Результаты</h2>
          {isGenerating &&
            generationProgress?.phase === "generating" &&
            generationProgress.total > 1 && (
              <span>
                {generationProgress.done}/{generationProgress.total}
              </span>
            )}
        </div>
        <details className="studio-create__deck">
          <summary>Импорт колоды и библиотека артов</summary>
          <div className="legacy-cover-ui">
            <DeckImportSection
              cardLibrary={cardLibrary}
              sources={sources}
              onAddSource={onAddCardSource}
              onRemoveSource={onRemoveCardSource}
              createLayoutMode={createLayoutMode}
              scenePlan={scenePlan}
            />
          </div>
        </details>
        {generationNotice && (
          <p className="studio-create__notice" role="status">
            {generationNotice}
          </p>
        )}
        {saveWarning && (
          <p
            className="studio-create__notice studio-create__notice--warning"
            role="status"
          >
            {saveWarning}
          </p>
        )}
        {error && (
          <p
            className="studio-create__notice studio-create__notice--error"
            role="alert"
          >
            {error}
          </p>
        )}
        {isUpscaling && (
          <p className="studio-create__notice" role="status">
            Увеличиваем разрешение. Исходный результат доступен для просмотра и
            скачивания.
          </p>
        )}
        {isGenerating && (
          <GenerationStage
            progress={generationProgress}
            sources={sources}
            aspectRatio={settings.aspectRatio}
            modelName={openRouterModel?.name || settings.model}
            onCancel={onCancelGeneration}
          />
        )}
        {results.length ? (
          <div
            className={`studio-create__results studio-create__results--${Math.min(results.length, 4)}`}
          >
            <AnimatePresence mode="popLayout">
            {results.map((url, index) => (
              <motion.article
                className="studio-create__result"
                key={url}
                data-result-reveal="true"
                layout
                initial={{ opacity: 0, y: 10, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  type="button"
                  className="studio-create__result-image"
                  style={{ aspectRatio: String(settings.aspectRatio).replace(':', ' / ') }}
                  onClick={() => setFullscreenImage(url)}
                  aria-label={`Открыть вариант ${index + 1}`}
                >
                  <OptimizedImage
                    src={url}
                    alt={`Вариант ${index + 1}`}
                    className="studio-create__image"
                    referrerPolicy="no-referrer"
                  />
                  <span className="studio-create__result-label">Вариант {index + 1}</span>
                </button>
                <div className="studio-create__result-actions">
                  <button type="button" onClick={() => download(url, index)}>
                    <Download size={16} />
                    Скачать
                  </button>
                  <button
                    type="button"
                    aria-pressed={likedSet.has(url)}
                    disabled={isGenerating}
                    onClick={() => void toggleLike(url)}
                  >
                    <Heart
                      size={16}
                      fill={likedSet.has(url) ? "currentColor" : "none"}
                    />
                    В избранное
                  </button>
                  <button type="button" onClick={() => setFullscreenImage(url)}>
                    <Expand size={16} />
                    Открыть
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpscale(url)}
                    disabled={
                      isUpscaling ||
                      isGenerating ||
                      availability !== "available"
                    }
                  >
                    <Maximize2 size={16} />
                    Апскейл
                  </button>
                  <button
                    type="button"
                    disabled={isGenerating || isUpscaling}
                    onClick={() => refine(url)}
                  >
                    Доработать
                  </button>
                </div>
              </motion.article>
            ))}
            </AnimatePresence>
          </div>
        ) : !isGenerating ? (
          <div className="studio-create__empty">
            <ImageIcon size={28} />
            <p>
              {reason ??
                "Всё готово к созданию. Запустите генерацию, чтобы увидеть варианты."}
            </p>
            <small>Выбранный формат: {settings.aspectRatio}</small>
          </div>
        ) : null}
      </section>
    </div>
  );
};
