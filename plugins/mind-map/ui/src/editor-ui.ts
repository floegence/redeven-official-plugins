export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 360;
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const SIDEBAR_WIDTH_STEP = 8;

export const CONTEXT_MENU_WIDTH = 196;
export const CONTEXT_MENU_HEIGHT = 282;
const FLOATING_PANEL_MARGIN = 8;
export const MIN_ZOOM = 0.32;
export const MAX_ZOOM = 2.4;
const WHEEL_DELTA_LIMIT = 240;
const WHEEL_ZOOM_RATE = 0.0015;
const EDITOR_POSITION_STEP = 2;
const EDITOR_SIZE_STEP = 2;
const EDITOR_ZOOM_SCALE = 1_000;

export type EditorViewport = { x: number; y: number; zoom: number };
export type EditorNodeBox = { x: number; y: number; width: number; height: number; depth: number };
export type NodeEditorPlacement = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  className: string;
};

export function normalizeSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value));
  return MIN_SIDEBAR_WIDTH + Math.round((clamped - MIN_SIDEBAR_WIDTH) / SIDEBAR_WIDTH_STEP) * SIDEBAR_WIDTH_STEP;
}

export function sidebarWidthClass(value: number): string {
  return `sidebar-width-${normalizeSidebarWidth(value)}`;
}

export function placeContextMenu(x: number, y: number, viewportWidth: number, viewportHeight: number): { x: number; y: number } {
  return {
    x: Math.max(FLOATING_PANEL_MARGIN, Math.min(x, viewportWidth - CONTEXT_MENU_WIDTH - FLOATING_PANEL_MARGIN)),
    y: Math.max(FLOATING_PANEL_MARGIN, Math.min(y, viewportHeight - CONTEXT_MENU_HEIGHT - FLOATING_PANEL_MARGIN)),
  };
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  const pixels = deltaMode === 1
    ? deltaY * 16
    : deltaMode === 2 ? deltaY * Math.max(1, viewportHeight) : deltaY;
  return Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, pixels));
}

export function wheelZoomTarget(currentZoom: number, deltaY: number, deltaMode: number, viewportHeight: number): number {
  const delta = normalizeWheelDelta(deltaY, deltaMode, viewportHeight);
  return clampZoom(clampZoom(currentZoom) * Math.exp(-delta * WHEEL_ZOOM_RATE));
}

export function zoomViewportAtPoint(
  viewport: EditorViewport,
  requestedZoom: number,
  anchorX: number,
  anchorY: number,
  canvasWidth: number,
  canvasHeight: number,
): EditorViewport {
  const currentZoom = clampZoom(viewport.zoom);
  const zoom = clampZoom(requestedZoom);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const worldX = (anchorX - centerX - viewport.x) / currentZoom;
  const worldY = (anchorY - centerY - viewport.y) / currentZoom;
  return {
    x: anchorX - centerX - worldX * zoom,
    y: anchorY - centerY - worldY * zoom,
    zoom,
  };
}

export function nodeEditorPlacement(
  node: EditorNodeBox,
  viewport: EditorViewport,
  canvasWidth: number,
  canvasHeight: number,
): NodeEditorPlacement {
  const zoomKey = Math.round(clampZoom(viewport.zoom) * EDITOR_ZOOM_SCALE);
  const zoom = zoomKey / EDITOR_ZOOM_SCALE;
  const width = quantize(node.width * zoom, EDITOR_SIZE_STEP);
  const height = quantize(node.height * zoom, EDITOR_SIZE_STEP);
  const rawX = canvasWidth / 2 + viewport.x + node.x * zoom;
  const rawY = canvasHeight / 2 + viewport.y + node.y * zoom;
  const centerX = quantize(rawX, EDITOR_POSITION_STEP);
  const centerY = quantize(rawY, EDITOR_POSITION_STEP);
  const kind = node.depth === 0 ? 'is-root' : node.depth === 1 ? 'is-branch' : 'is-topic';
  return {
    centerX,
    centerY,
    width,
    height,
    className: `node-title-editor ${kind} node-editor-x-${centerX} node-editor-y-${centerY} node-editor-w-${width} node-editor-h-${height} node-editor-z-${zoomKey}`,
  };
}

export function preserveNodeScreenPosition(
  viewport: EditorViewport,
  before: Pick<EditorNodeBox, 'x' | 'y'>,
  after: Pick<EditorNodeBox, 'x' | 'y'>,
): EditorViewport {
  return {
    x: viewport.x + (before.x - after.x) * viewport.zoom,
    y: viewport.y + (before.y - after.y) * viewport.zoom,
    zoom: viewport.zoom,
  };
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}
