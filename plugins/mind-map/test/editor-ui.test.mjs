import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampZoom,
  nodeEditorPlacement,
  normalizeSidebarWidth,
  normalizeWheelDelta,
  placeContextMenu,
  wheelZoomTarget,
  zoomViewportAtPoint,
} from '../ui/src/editor-ui.ts';

describe('Mind Map editor UI geometry', () => {
  it('clamps and quantizes the adjustable sidebar width', () => {
    assert.equal(normalizeSidebarWidth(Number.NaN), DEFAULT_SIDEBAR_WIDTH);
    assert.equal(normalizeSidebarWidth(0), MIN_SIDEBAR_WIDTH);
    assert.equal(normalizeSidebarWidth(999), MAX_SIDEBAR_WIDTH);
    assert.equal(normalizeSidebarWidth(247), 248);
    assert.equal(normalizeSidebarWidth(251), 248);
  });

  it('keeps the node context menu inside the canvas viewport', () => {
    assert.deepEqual(placeContextMenu(12, 20, 960, 600), { x: 12, y: 20 });
    assert.deepEqual(placeContextMenu(950, 590, 960, 600), { x: 756, y: 310 });
    assert.deepEqual(placeContextMenu(-20, -30, 960, 600), { x: 8, y: 8 });
  });

  it('normalizes wheel input and keeps zoom inside the supported range', () => {
    assert.equal(normalizeWheelDelta(32, 0, 800), 32);
    assert.equal(normalizeWheelDelta(2, 1, 800), 32);
    assert.equal(normalizeWheelDelta(1, 2, 800), 240);
    assert.equal(normalizeWheelDelta(-10_000, 0, 800), -240);
    assert.equal(clampZoom(0.1), 0.42);
    assert.equal(clampZoom(8), 2.4);
    assert.ok(wheelZoomTarget(1, -120, 0, 800) > 1);
    assert.ok(wheelZoomTarget(1, 120, 0, 800) < 1);
    assert.equal(wheelZoomTarget(1, 0, 0, 800), 1);
  });

  it('preserves the world point below the mouse while zooming', () => {
    const viewport = { x: 48, y: -36, zoom: 0.8 };
    const anchor = { x: 720, y: 180 };
    const before = {
      x: (anchor.x - 480 - viewport.x) / viewport.zoom,
      y: (anchor.y - 300 - viewport.y) / viewport.zoom,
    };
    const next = zoomViewportAtPoint(viewport, 1.4, anchor.x, anchor.y, 960, 600);
    const after = {
      x: (anchor.x - 480 - next.x) / next.zoom,
      y: (anchor.y - 300 - next.y) / next.zoom,
    };
    assert.ok(Math.abs(after.x - before.x) < 1e-9);
    assert.ok(Math.abs(after.y - before.y) < 1e-9);
  });

  it('places a lightweight editor over the selected node with bounded geometry', () => {
    const placement = nodeEditorPlacement(
      { x: 0, y: 0, width: 160, height: 54, depth: 0 },
      { x: 0, y: 0, zoom: 1 },
      960,
      600,
    );
    assert.deepEqual(placement, {
      centerX: 480,
      centerY: 300,
      width: 176,
      className: 'node-title-editor is-root node-editor-x-480 node-editor-y-300 node-editor-w-176',
    });

    const bounded = nodeEditorPlacement(
      { x: 2_000, y: -2_000, width: 400, height: 36, depth: 3 },
      { x: 0, y: 0, zoom: 2 },
      640,
      480,
    );
    assert.ok(bounded.centerX <= 460);
    assert.ok(bounded.centerY >= 28);
    assert.ok(bounded.width <= 344);
    assert.match(bounded.className, /is-topic/u);
  });
});
