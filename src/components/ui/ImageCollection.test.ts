import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCollection, COLLECTION_PAGE_SIZE } from "./ImageCollection";
import { HistoryTab } from "../tabs/HistoryTab";
import { clearHistory } from "../../services/serverStorageService";
vi.mock("../../services/serverStorageService", () => ({
  clearHistory: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const images = Array.from({ length: 49 }, (_, i) => `/uploads/cover-${i}.png`);
const props = {
  kind: "history" as const,
  images,
  likedSet: new Set([images[24]]),
  toggleLike: vi.fn(),
  handleUpscale: vi.fn(),
  setFullscreenImage: vi.fn(),
  onRefine: vi.fn(),
};
async function render(value: React.ReactNode) {
  await act(async () => root.render(value));
}
async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("image-only bounded collections", () => {
  it("renders one page and reaches every image in order without mutating the input", async () => {
    await render(React.createElement(ImageCollection, props));
    expect(container.querySelectorAll("img")).toHaveLength(
      COLLECTION_PAGE_SIZE,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).not.toContain("Видео");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Предыдущая страница"]',
      )?.disabled,
    ).toBe(true);
    await click("Следующая страница");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      images[24],
    );
    await click("Следующая страница");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      images[48],
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Следующая страница"]',
      )?.disabled,
    ).toBe(true);
    await click("Предыдущая страница");
    expect(container.querySelectorAll("img")).toHaveLength(24);
    expect(images).toHaveLength(49);
  });
  it("routes keyboard-accessible card actions to the correct image on the second page", async () => {
    await render(React.createElement(ImageCollection, props));
    await click("Следующая страница");
    await click("Открыть обложку 25");
    await click("Убрать из избранного");
    await click("Улучшить качество");
    await click("Использовать как основу");
    for (const fn of [
      props.setFullscreenImage,
      props.toggleLike,
      props.handleUpscale,
      props.onRefine,
    ])
      expect(fn).toHaveBeenCalledWith(images[24]);
  });
  it("clamps the page after removing the last item, then shows the empty state", async () => {
    await render(React.createElement(ImageCollection, props));
    await click("Следующая страница");
    await click("Следующая страница");
    await render(
      React.createElement(ImageCollection, {
        ...props,
        images: images.slice(0, 48),
      }),
    );
    expect(container.querySelectorAll("img")).toHaveLength(24);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "25–48",
    );
    await render(
      React.createElement(ImageCollection, { ...props, images: [] }),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.textContent).toContain("Здесь появятся ваши обложки");
  });
  it("clears image history once only after the storage operation succeeds", async () => {
    const update = vi.fn();
    vi.mocked(clearHistory).mockResolvedValue();
    await render(
      React.createElement(HistoryTab, {
        ...props,
        history: images,
        setHistory: update,
      }),
    );
    expect(clearHistory).not.toHaveBeenCalled();
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Очистить историю"),
    )!;
    await act(async () => button.click());
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith([]);
  });
  it("keeps visible history and offers retry on a failed clear request", async () => {
    const update = vi.fn();
    vi.mocked(clearHistory).mockRejectedValue(new Error("offline"));
    await render(
      React.createElement(HistoryTab, {
        ...props,
        history: images,
        setHistory: update,
      }),
    );
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Очистить историю"),
    )!;
    await act(async () => button.click());
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Не удалось",
    );
    expect(button.disabled).toBe(false);
  });
});
