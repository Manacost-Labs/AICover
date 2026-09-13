import { describe, expect, it, vi } from "vitest";

import {
  loadGenerationServiceForRun,
  type GenerationService,
} from "./generationServiceLoader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("deferred generation service", () => {
  it("cannot revive a cancelled run with the next run's controller", async () => {
    const firstModule = deferred<GenerationService>();
    const paidRequest = vi.fn();
    const service = { generateFusedCover: paidRequest } as unknown as GenerationService;
    const firstController = new AbortController();
    let firstCurrent = true;

    const first = loadGenerationServiceForRun(
      firstController.signal,
      () => firstCurrent,
      () => firstModule.promise,
    );

    firstController.abort();
    firstCurrent = false;
    const secondController = new AbortController();
    const second = loadGenerationServiceForRun(
      secondController.signal,
      () => true,
      async () => service,
    );
    firstModule.resolve(service);

    expect(await first).toBeNull();
    expect(await second).toBe(service);
    expect(paidRequest).not.toHaveBeenCalled();
  });
});
