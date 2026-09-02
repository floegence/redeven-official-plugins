import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cameraTarget, platformSpawnPose, sceneryForwardDistance, sceneMotion } from '../ui/src/scene-3d.ts';
import { projectPoint } from '../ui/src/software-3d.ts';

describe('Pocket Pounce 3D scene', () => {
  it('shows both routes as rear-oblique top-down screen diagonals', () => {
    const player = { x: -2.2, y: 0.52, z: 0 };
    for (const direction of [{ x: 0.54, z: -0.84 }, { x: -0.54, z: -0.84 }]) {
      const target = {
        x: player.x + direction.x * 6.4,
        y: 0.15,
        z: player.z + direction.z * 6.4,
      };
      const desired = cameraTarget(player, 0, { x: player.x, z: player.z }, direction);
      const projectedPlayer = projectPoint(player, { ...desired, fovDegrees: 37 }, 960, 540);
      const projectedTarget = projectPoint(target, { ...desired, fovDegrees: 37 }, 960, 540);
      assert.ok(projectedPlayer);
      assert.ok(projectedTarget);
      assert.ok(projectedTarget.y < projectedPlayer.y - 45);
      assert.equal(Math.sign(projectedTarget.x - projectedPlayer.x), Math.sign(direction.x));
      const horizontalDistance = Math.hypot(
        desired.position.x - desired.lookAt.x,
        desired.position.z - desired.lookAt.z,
      );
      const downwardAngle = Math.atan2(desired.position.y - desired.lookAt.y, horizontalDistance);
      assert.ok(downwardAngle > Math.PI * 0.27);
      assert.ok(downwardAngle < Math.PI * 0.39);
    }
  });

  it('raises the camera with the player without chasing the jump forward', () => {
    const direction = { x: 0.54, z: -0.84 };
    const grounded = cameraTarget({ x: -2, y: 0.52, z: 0 }, 0, { x: -2, z: 0 }, direction);
    const airborne = cameraTarget({ x: 0, y: 4.52, z: -3 }, 0, { x: -2, z: 0 }, direction);
    assert.equal(airborne.position.z, grounded.position.z);
    assert.equal(airborne.lookAt.z, grounded.lookAt.z);
    assert.ok(airborne.position.y > grounded.position.y + 2);
    assert.ok(airborne.lookAt.y > grounded.lookAt.y);
  });

  it('animates a new platform upward with overshoot, turn, and glow', () => {
    const hidden = platformSpawnPose(0, 0.64, 0.2);
    const entering = platformSpawnPose(0.28, 0.64, 0.2);
    const settled = platformSpawnPose(0.64, 0.64, 0.2);
    assert.ok(hidden.elevation < -1);
    assert.ok(hidden.scale < 0.2);
    assert.ok(Math.abs(hidden.rotation) > Math.abs(settled.rotation));
    assert.ok(entering.scale > 0.7);
    assert.ok(entering.glow > settled.glow);
    assert.equal(settled.elevation, 0);
    assert.equal(settled.scale, 1);
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

  it('couples charge, jump, edge fall, and landing to distinct motion profiles', () => {
    const charging = sceneMotion('charging', 0.9, 0, 0, 240, 'none');
    const rising = sceneMotion('jumping', 0, 7.2, 0, 240, 'none');
    const edge = sceneMotion('jumping', 0, -5, 0, 240, 'edge');
    const landing = sceneMotion('landed', 0, 0, 0.04, 240, 'none');
    assert.ok(charging.scaleY < 0.72);
    assert.ok(charging.coil > 0.7);
    assert.ok(charging.platformCompression > 0.18);
    assert.ok(rising.scaleY > 1);
    assert.ok(rising.tilt < -0.1);
    assert.ok(edge.fallRoll > 0.2);
    assert.ok(landing.impact > 0.5);
    assert.ok(landing.scaleX > 1);
  });
});
