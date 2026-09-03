export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 360;
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const SIDEBAR_WIDTH_STEP = 8;

export const CONTEXT_MENU_WIDTH = 196;
export const CONTEXT_MENU_HEIGHT = 282;
const FLOATING_PANEL_MARGIN = 8;

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
