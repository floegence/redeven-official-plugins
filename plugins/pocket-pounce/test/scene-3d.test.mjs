import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectPoint, sceneMotion } from '../ui/src/scene-3d.ts';

describe('Pocket Pounce 3D scene', () => {
  it('uses perspective so nearer points render larger than distant points', () => {
    const near = projectPoint({ x: 480, y: 380, z: -120 }, 0, 0);
    const far = projectPoint({ x: 480, y: 380, z: 120 }, 0, 0);
    assert.ok(near.scale > far.scale);
    assert.notEqual(near.y, far.y);
  });

  it('gives charging, jumping, and landing distinct motion profiles', () => {
    const charging = sceneMotion('charging', 0.9, 0, 0, 240);
    const rising = sceneMotion('jumping', 0, -420, 0, 240);
    const landing = sceneMotion('landed', 0, 0, 0.04, 240);
    assert.ok(charging.scaleY < 0.8);
    assert.ok(charging.coil > 0.7);
    assert.ok(rising.stretchY > 1);
    assert.ok(Math.abs(rising.tilt) > 0.1);
    assert.ok(landing.impact > 0.5);
    assert.ok(landing.scaleX > 1);
  });
});
