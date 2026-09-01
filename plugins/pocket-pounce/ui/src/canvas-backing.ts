export const MAX_CANVAS_BACKING_DIMENSION = 2_048;

export type CanvasBackingSize = {
  width: number;
  height: number;
  pixelRatio: number;
};

export function canvasBackingSize(
  cssWidth: number,
  cssHeight: number,
  requestedPixelRatio: number,
): CanvasBackingSize {
  const safeWidth = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
  const safeHeight = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
  const requested = clamp(Number.isFinite(requestedPixelRatio) ? requestedPixelRatio : 1, 0.5, 4);
  const bounded = Math.min(
    requested,
    MAX_CANVAS_BACKING_DIMENSION / safeWidth,
    MAX_CANVAS_BACKING_DIMENSION / safeHeight,
  );
  const width = Math.max(1, Math.min(MAX_CANVAS_BACKING_DIMENSION, Math.round(safeWidth * bounded)));
  const height = Math.max(1, Math.min(MAX_CANVAS_BACKING_DIMENSION, Math.round(safeHeight * bounded)));

  return {
    width,
    height,
    pixelRatio: Math.min(width / safeWidth, height / safeHeight),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
