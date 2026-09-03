import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  normalizeSidebarWidth,
  placeContextMenu,
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
});
