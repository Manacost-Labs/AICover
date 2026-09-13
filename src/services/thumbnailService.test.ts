import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./geminiClient", () => ({
  createGeminiClient: async () => ({ models: sdk }),
}));
import { generateHearthstoneThumbnailBackgrounds } from "./thumbnailService";
beforeEach(() =>
  sdk.generateContent
    .mockReset()
    .mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "AA==", mimeType: "image/png" } }],
          },
        },
      ],
    }),
);
describe("thumbnail with asynchronously loaded SDK", () => {
  it.each(["gemini-3-pro-image", "gemini-3.1-flash-lite-image"])(
    "preserves model and supported size for %s",
    async (model) => {
      const progress = vi.fn();
      const result = await generateHearthstoneThumbnailBackgrounds(
        [
          {
            id: "asset",
            name: "Art",
            imageUrl: "data:image/png;base64,AA==",
            source: "upload",
          },
        ],
        {
          model,
          imageSize: "1K",
          batchSize: 1,
          layout: "text-left",
          stylePrompt: "Preserve art",
        },
        progress,
      );
      expect(result).toEqual(["data:image/png;base64,AA=="]);
      expect(sdk.generateContent.mock.calls[0][0].model).toBe(model);
      expect(sdk.generateContent.mock.calls[0][0].config.imageConfig).toEqual(
        model.includes("lite")
          ? { aspectRatio: "16:9" }
          : { aspectRatio: "16:9", imageSize: "1K" },
      );
      expect(progress).toHaveBeenCalledWith(1, 1);
    },
  );

  it('uses the same-origin GPT adapter sequentially before loading Gemini', async () => {
    let finishFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,second' })));
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();

    const work = generateHearthstoneThumbnailBackgrounds(
      [{ id: 'asset', name: 'Art', imageUrl: 'data:image/png;base64,AA==', source: 'upload' }],
      { model: 'gpt-image-2', imageSize: '1K', batchSize: 2, layout: 'text-left', stylePrompt: 'Preserve art' },
      progress,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sdk.generateContent).not.toHaveBeenCalled();
    finishFirst(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,first' })));
    await expect(work).resolves.toEqual(['data:image/png;base64,first', 'data:image/png;base64,second']);

    expect(sdk.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2);
  });
  it('rejects invalid GPT batch sizes before making requests', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const batchSize of [0, 5, 1.5, NaN]) {
      await expect(generateHearthstoneThumbnailBackgrounds(
        [{ id: 'a', name: 'Art', imageUrl: 'data:image/png;base64,AA==', source: 'upload' }],
        { model: 'gpt-image-2', imageSize: '1K', batchSize, layout: 'text-left', stylePrompt: '' } as any,
      )).rejects.toThrow('от 1 до 4');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('stops the thumbnail batch after the first result when cancelled', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,first' }))));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateHearthstoneThumbnailBackgrounds(
      [{ id: 'a', name: 'Art', imageUrl: 'data:image/png;base64,AA==', source: 'upload' }],
      { model: 'gpt-image-2', imageSize: '1K', batchSize: 4, layout: 'text-left', stylePrompt: '' },
      () => controller.abort(), controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
