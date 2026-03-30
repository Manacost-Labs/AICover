/** Pure helpers for mapping pointer coordinates to canvas bitmap space (tests without DOM). */

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Map viewport client coordinates to canvas pixel coordinates.
 * `canvasWidth` / `canvasHeight` are the bitmap dimensions (canvas.width / canvas.height).
 */
export function mapClientToCanvasCoords(
  clientX: number,
  clientY: number,
  canvasRect: Rect,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    return { x: 0, y: 0 };
  }
  const nx = (clientX - canvasRect.left) / canvasRect.width;
  const ny = (clientY - canvasRect.top) / canvasRect.height;
  return {
    x: nx * canvasWidth,
    y: ny * canvasHeight,
  };
}
