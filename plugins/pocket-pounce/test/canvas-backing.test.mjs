import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CANVAS_BACKING_DIMENSION,
  canvasBackingSize,
} from '../ui/src/canvas-backing.ts';

describe('Pocket Pounce Canvas backing store', () => {
  it('preserves normal Retina rendering', () => {
    assert.deepEqual(canvasBackingSize(918, 642, 2), {
      width: 1836,
      height: 1284,
      pixelRatio: 2,
    });
  });

  it('caps zoomed Workbench surfaces before they reach the worker budget', () => {
    const size = canvasBackingSize(2845, 1600, 2);
    assert.equal(size.width, MAX_CANVAS_BACKING_DIMENSION);
    assert.ok(size.height <= MAX_CANVAS_BACKING_DIMENSION);
    assert.ok(size.width * size.height <= MAX_CANVAS_BACKING_DIMENSION ** 2);
    assert.ok(size.pixelRatio < 1);
  });

  it('keeps every resize axis inside one fixed backing-store budget', () => {
    for (const [width, height, ratio] of [
      [4096, 800, 4],
      [800, 4096, 4],
      [4096, 4096, 4],
      [1, 1, 4],
    ]) {
      const size = canvasBackingSize(width, height, ratio);
      assert.ok(size.width >= 1 && size.width <= MAX_CANVAS_BACKING_DIMENSION);
      assert.ok(size.height >= 1 && size.height <= MAX_CANVAS_BACKING_DIMENSION);
      assert.ok(size.width * size.height <= MAX_CANVAS_BACKING_DIMENSION ** 2);
    }
  });
});
