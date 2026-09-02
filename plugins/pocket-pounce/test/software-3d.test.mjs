import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCylinderFaces,
  buildEllipsoidFaces,
  buildPrismFaces,
  projectPoint,
  sortFacesBackToFront,
} from '../ui/src/software-3d.ts';

const camera = {
  position: { x: 0, y: 10.4, z: 7.2 },
  lookAt: { x: 0, y: 0.3, z: -1.8 },
  fovDegrees: 38,
};

describe('Pocket Pounce software 3D renderer', () => {
  it('projects forward and lateral world positions through one perspective camera', () => {
    const player = projectPoint({ x: 0, y: 0.52, z: 0 }, camera, 960, 540);
    const target = projectPoint({ x: 0, y: 0.2, z: -6 }, camera, 960, 540);
    assert.ok(player);
    assert.ok(target);
    assert.ok(Math.abs(player.x - 480) < 0.001);
    assert.ok(Math.abs(target.x - 480) < 0.001);
    assert.ok(target.y < player.y);
    assert.ok(target.depth > player.depth);
    assert.ok(target.scale < player.scale);
  });

  it('builds closed prisms for non-round platform silhouettes', () => {
    const footprint = [
      { x: -2, z: -1 }, { x: 2, z: -1 }, { x: 2, z: 1 }, { x: -2, z: 1 },
    ];
    const faces = buildPrismFaces(footprint, 0.2, 1.1, '#dcb274', ['#96604d', '#704353']);
    assert.equal(faces.length, 5);
    assert.ok(faces.every((face) => face.points.length >= 3));
    assert.equal(faces.at(-1).color, '#dcb274');
    assert.equal(faces[0].color, '#96604d');
    assert.equal(faces[1].color, '#704353');
  });

  it('clips points behind the camera near plane', () => {
    assert.equal(projectPoint({ x: -5, y: 11, z: 8 }, camera, 960, 540), undefined);
  });

  it('builds real closed 3D volumes for stones and the jerboa', () => {
    const stone = buildCylinderFaces({ x: 0, y: -0.52, z: -5 }, 1.8, 1.2, 1.04, 8, '#c17b63', '#8f4f4f');
    const body = buildEllipsoidFaces({ x: 0, y: 0.7, z: 0 }, { x: 0.45, y: 0.58, z: 0.54 }, 6, 8, '#d77f66');
    assert.equal(stone.length, 9);
    assert.ok(body.length >= 40);
    assert.ok(stone.every((face) => face.points.length >= 3));
    assert.ok(body.every((face) => face.points.length >= 3));
  });

  it('sorts faces from far to near for the Canvas2D painter', () => {
    const faces = [
      { points: [{ x: 0, y: 0, z: 0 }], color: '#fff' },
      { points: [{ x: 0, y: 0, z: -10 }], color: '#000' },
    ];
    const sorted = sortFacesBackToFront(faces, camera);
    assert.equal(sorted[0].color, '#000');
    assert.equal(sorted[1].color, '#fff');
  });
});
