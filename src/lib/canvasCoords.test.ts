import { describe, it, expect } from 'vitest';
import { mapClientToCanvasCoords } from './canvasCoords';

describe('mapClientToCanvasCoords', () => {
  it('maps center of rect to center of canvas bitmap', () => {
    const rect = { left: 100, top: 200, width: 400, height: 300 };
    const p = mapClientToCanvasCoords(300, 350, rect, 800, 600);
    expect(p.x).toBe(400);
    expect(p.y).toBe(300);
  });

  it('maps top-left of rect to 0,0', () => {
    const rect = { left: 50, top: 60, width: 200, height: 100 };
    const p = mapClientToCanvasCoords(50, 60, rect, 200, 100);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it('returns zeros for zero-height rect', () => {
    const rect = { left: 0, top: 0, width: 100, height: 0 };
    const p = mapClientToCanvasCoords(50, 50, rect, 100, 100);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
});
