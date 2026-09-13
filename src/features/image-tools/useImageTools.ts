import { useRef, useState } from "react";
import type {
  GenerationSettings,
  ImageSource,
} from "../../services/generationContracts";
import { loadGenerationService } from "../../services/generationServiceLoader";

export type ImageToolOperation = "expand" | "upscale";
export interface ToolSource extends ImageSource {
  name?: string;
}
export interface ToolSettings {
  model: string;
  imageSize: "1K" | "2K" | "4K";
  aspectRatio: GenerationSettings["aspectRatio"];
  prompt: string;
}
export interface ToolResult {
  id: string;
  operation: ImageToolOperation;
  source: ToolSource;
  settings: ToolSettings;
  status: "loading" | "done" | "error";
  output?: string;
  error?: string;
  warning?: string;
}

/** Lives in App, so uploads, parameters and in-flight work survive navigation. */
export function useImageTools(options: {
  available: boolean;
  onSave: (url: string) => Promise<void>;
}) {
  const [source, setSource] = useState<ToolSource | null>(null);
  const [operation, setOperation] = useState<ImageToolOperation>("expand");
  const [settings, setSettings] = useState<ToolSettings>({
    model: "gemini-3.1-flash-image",
    imageSize: "4K",
    aspectRatio: "16:9",
    prompt: "",
  });
  const [results, setResults] = useState<ToolResult[]>([]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  async function execute(previous?: ToolResult) {
    if (running.current || !latest.current.available) return;
    const input = previous?.source ?? source;
    if (!input) return;
    // Capture all request inputs, not whichever settings happen to be visible later.
    const item: ToolResult = {
      id: previous?.id ?? crypto.randomUUID(),
      operation: previous?.operation ?? operation,
      source: { ...input },
      settings: { ...(previous?.settings ?? settings) },
      status: "loading",
    };
    running.current = true;
    setBusy(true);
    setResults((items) =>
      previous
        ? items.map((row) => (row.id === item.id ? item : row))
        : [item, ...items],
    );
    const update = (patch: Partial<ToolResult>) =>
      setResults((items) =>
        items.map((row) => (row.id === item.id ? { ...row, ...patch } : row)),
      );
    try {
      const { expandImage, upscaleImage } = await loadGenerationService();
      const output =
        item.operation === "upscale"
          ? await upscaleImage(
              item.source,
              item.settings.imageSize,
              item.settings.model,
            )
          : await expandImage(
              item.source,
              item.settings.aspectRatio,
              item.settings.prompt,
              item.settings.model,
            );
      update({ output, status: "done" });
      try {
        await latest.current.onSave(output);
      } catch {
        update({
          warning:
            "Не удалось сохранить результат на сервере. Скачайте его, чтобы не потерять.",
        });
      }
    } catch (error) {
      update({
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Не удалось обработать изображение. Попробуйте ещё раз.",
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function useResult(id: string) {
    const item = results.find((row) => row.id === id);
    if (!item?.output || item.status !== "done") return;
    setSource({
      data: item.output,
      mimeType: /^data:([^;]+);/.exec(item.output)?.[1] ?? "image/png",
      name: "Результат обработки",
    });
    setOperation(item.operation === "expand" ? "upscale" : "expand");
  }

  return {
    source,
    setSource,
    operation,
    setOperation,
    settings,
    setSettings,
    results,
    busy,
    run: () => execute(),
    retry: (id: string) => {
      const item = results.find(
        (row) => row.id === id && row.status === "error",
      );
      return item ? execute(item) : Promise.resolve();
    },
    clearResults: () => {
      if (!running.current) setResults([]);
    },
    useResult,
    addExternalResult: (item: ToolResult) =>
      setResults((items) => [item, ...items]),
  };
}

export type ImageToolsController = ReturnType<typeof useImageTools>;
