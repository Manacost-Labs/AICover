import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useImageTools } from "./useImageTools";

const api = vi.hoisted(() => ({ upscale: vi.fn(), expand: vi.fn() }));
vi.mock("../../services/geminiService", () => ({
  upscaleImage: api.upscale,
  expandImage: api.expand,
}));
let tools: ReturnType<typeof useImageTools>;
let root: Root;
let host: HTMLDivElement;
const save = vi.fn();
let allowed = true;
const source = {
  data: "data:image/jpeg;base64,original",
  mimeType: "image/jpeg",
  name: "Original.jpg",
};
function Harness() {
  tools = useImageTools({ available: allowed, onSave: save });
  return null;
}
async function render() {
  await act(async () => root.render(React.createElement(Harness)));
}
const deferred = () => {
  let resolve!: (url: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.upscale.mockReset().mockResolvedValue("data:image/png;base64,quality");
  api.expand.mockReset().mockResolvedValue("data:image/webp;base64,format");
  save.mockReset().mockResolvedValue(undefined);
  allowed = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
  await act(async () => tools.setSource(source));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("shares the source and preserves per-operation parameters", async () => {
  await act(async () =>
    tools.setSettings((s) => ({
      ...s,
      aspectRatio: "9:16",
      imageSize: "2K",
      prompt: "Soft background",
    })),
  );
  await act(async () => tools.setOperation("upscale"));
  expect(tools.source).toEqual(source);
  await act(async () => tools.run());
  expect(api.upscale).toHaveBeenCalledWith(
    source,
    "2K",
    "gemini-3.1-flash-image-preview",
  );
  expect(tools.source).toEqual(source);
  await act(async () => tools.setOperation("expand"));
  await act(async () => tools.run());
  expect(api.expand).toHaveBeenCalledWith(
    source,
    "9:16",
    "Soft background",
    "gemini-3.1-flash-image-preview",
  );
  expect(tools.results.map((r) => r.operation)).toEqual(["expand", "upscale"]);
});

it("snapshots the in-flight operation and blocks duplicate requests and clear", async () => {
  const request = deferred();
  api.expand.mockReturnValue(request.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = tools.run();
    void tools.run();
    tools.clearResults();
  });
  expect(api.expand).toHaveBeenCalledTimes(1);
  expect(tools.results).toHaveLength(1);
  expect(tools.busy).toBe(true);
  const id = tools.results[0].id;
  await act(async () => {
    tools.setSource({ ...source, data: "replacement" });
    tools.setOperation("upscale");
  });
  await act(async () => {
    request.resolve("done");
    await pending;
  });
  expect(tools.results[0]).toMatchObject({
    id,
    source,
    operation: "expand",
    output: "done",
    status: "done",
  });
  expect(tools.source?.data).toBe("replacement");
  expect(tools.busy).toBe(false);
});

it("retries the failed item with its original input, model and parameters", async () => {
  api.expand.mockRejectedValueOnce(new Error("Temporary failure"));
  await act(async () => tools.run());
  const failed = tools.results[0];
  expect(failed.status).toBe("error");
  await act(async () => {
    tools.setSource({ ...source, data: "different" });
    tools.setOperation("upscale");
    tools.setSettings((s) => ({
      ...s,
      model: "gemini-3-pro-image-preview",
      aspectRatio: "1:1",
    }));
  });
  await act(async () => tools.retry(failed.id));
  expect(api.expand.mock.calls[1]).toEqual(api.expand.mock.calls[0]);
  expect(api.upscale).not.toHaveBeenCalled();
  expect(tools.results).toHaveLength(1);
  expect(tools.results[0]).toMatchObject({ id: failed.id, status: "done" });
  expect(tools.results[0].error).toBeUndefined();
});

it("keeps the generated result available if persistence fails", async () => {
  save.mockRejectedValueOnce(new Error("Storage failed"));
  await act(async () => tools.run());
  expect(tools.results[0]).toMatchObject({
    status: "done",
    output: "data:image/webp;base64,format",
  });
  expect(tools.results[0].warning).toContain("Не удалось сохранить");
  expect(tools.results[0].error).toBeUndefined();
});

it("reuses a result as the source for the other operation, with correct MIME type", async () => {
  await act(async () => tools.run());
  await act(async () => tools.useResult(tools.results[0].id));
  expect(tools.operation).toBe("upscale");
  expect(tools.source).toMatchObject({
    data: "data:image/webp;base64,format",
    mimeType: "image/webp",
  });
  await act(async () => tools.run());
  expect(api.upscale.mock.calls[0][0].mimeType).toBe("image/webp");
  expect(tools.results).toHaveLength(2);
});

it("does not call generation without a source or available provider", async () => {
  allowed = false;
  await render();
  await act(async () => tools.run());
  expect(api.expand).not.toHaveBeenCalled();
  allowed = true;
  await render();
  await act(async () => tools.setSource(null));
  await act(async () => tools.run());
  expect(api.expand).not.toHaveBeenCalled();
});
