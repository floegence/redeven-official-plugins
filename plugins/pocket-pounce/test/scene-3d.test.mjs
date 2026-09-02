import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cameraTarget, sceneryForwardDistance, sceneMotion } from '../ui/src/scene-3d.ts';

describe('Pocket Pounce 3D scene', () => {
  it('uses a centered high oblique overview and follows only the vertical part of a jump', () => {
    const grounded = cameraTarget({ x: 0, y: 0.55, z: -8 }, 0, -8);
    const airborne = cameraTarget({ x: 0, y: 4.55, z: -11 }, 0, -8);
    const horizontalDistance = Math.hypot(
      grounded.position.x - grounded.lookAt.x,
      grounded.position.z - grounded.lookAt.z,
    );
    const downwardAngle = Math.atan2(grounded.position.y - grounded.lookAt.y, horizontalDistance);
    assert.equal(grounded.position.x, grounded.lookAt.x);
    assert.ok(grounded.position.y > 9);
    assert.ok(grounded.position.z > -8);
    assert.ok(grounded.lookAt.z < -8);
    assert.ok(downwardAngle > Math.PI * 0.22);
    assert.ok(downwardAngle < Math.PI * 0.32);
    assert.equal(airborne.position.z, grounded.position.z);
    assert.equal(airborne.lookAt.z, grounded.lookAt.z);
    assert.ok(airborne.position.y > grounded.position.y + 1.8);
    assert.ok(airborne.position.y < grounded.position.y + 3);
    assert.ok(airborne.lookAt.y > grounded.lookAt.y);
  });

  it('keeps decorative scenery safely ahead of the camera', () => {
    for (const playerZ of [0, -5, -42, -180]) {
      for (let index = 0; index < 9; index += 1) {
        const distance = sceneryForwardDistance(index, playerZ);
        assert.ok(distance >= 16);
        assert.ok(distance < 92);
      }
    }
  });

  it('gives charging, jumping, and landing distinct motion profiles', () => {
    const charging = sceneMotion('charging', 0.9, 0, 0, 240);
    const rising = sceneMotion('jumping', 0, 7.2, 0, 240);
    const landing = sceneMotion('landed', 0, 0, 0.04, 240);
    assert.ok(charging.scaleY < 0.8);
    assert.ok(charging.coil > 0.7);
    assert.ok(rising.scaleY > 1);
    assert.ok(rising.tilt < -0.1);
    assert.ok(landing.impact > 0.5);
    assert.ok(landing.scaleX > 1);
  });
});
