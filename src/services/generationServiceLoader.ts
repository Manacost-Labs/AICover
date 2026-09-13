export type GenerationService = typeof import("./geminiService");

let servicePromise: Promise<GenerationService> | null = null;

export function loadGenerationService(): Promise<GenerationService> {
  servicePromise ??= import("./geminiService").catch((error) => {
    servicePromise = null;
    throw error;
  });
  return servicePromise;
}

export async function loadGenerationServiceForRun(
  signal: AbortSignal,
  isCurrent: () => boolean,
  loader: () => Promise<GenerationService> = loadGenerationService,
): Promise<GenerationService | null> {
  const service = await loader();
  return signal.aborted || !isCurrent() ? null : service;
}
