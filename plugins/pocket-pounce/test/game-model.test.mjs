import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGE_MAX_MS,
  MIN_PLATFORM_WIDTH,
  PLAYER_RADIUS,
  beginCharge,
  cancelCharge,
  chargeRatio,
  createGame,
  jumpDistanceForCharge,
  platformContainsSupport,
  predictedLandingPoint,
  releaseJump,
  stepGame,
  targetPlatform,
} from '../ui/src/game-model.ts';

function forceLanding(state, xOffset = 0, zOffset = 0) {
  const target = targetPlatform(state);
  assert.ok(target);
  state.phase = 'jumping';
  state.player.x = target.x + xOffset;
  state.player.z = target.z + zOffset;
  state.player.y = target.top + state.player.radius + 0.025;
  state.player.vx = 0;
  state.player.vy = -1.8;
  state.player.vz = 0;
  stepGame(state, 1 / 30);
  return target;
}

describe('Pocket Pounce game model', () => {
  it('clamps charge and maps longer holds to longer jumps', () => {
    assert.equal(chargeRatio(-1), 0);
    assert.equal(chargeRatio(CHARGE_MAX_MS * 2), 1);
    assert.ok(jumpDistanceForCharge(0.9) > jumpDistanceForCharge(0.2));
  });

  it('accepts one charge and ignores repeated starts or releases while airborne', () => {
    const state = createGame(7);
    assert.equal(beginCharge(state, 100), true);
    assert.equal(beginCharge(state, 200), false);
    assert.equal(releaseJump(state, 550), true);
    assert.equal(state.phase, 'jumping');
    assert.equal(releaseJump(state, 700), false);
  });

  it('cancels a held charge without launching', () => {
    const state = createGame(9);
    beginCharge(state, 100);
    assert.equal(cancelCharge(state), true);
    assert.equal(state.phase, 'ready');
    assert.equal(state.player.vx, 0);
    assert.equal(state.player.vy, 0);
    assert.equal(state.player.vz, 0);
  });

  it('starts bottom-left to top-right, then interleaves the opposite diagonal', () => {
    const state = createGame(11);
    const horizontalDirections = [];
    for (let index = 0; index < 12; index += 1) {
      const current = state.platforms.find((platform) => platform.id === state.currentPlatformID);
      const target = targetPlatform(state);
      assert.ok(current);
      assert.ok(target);
      assert.ok(target.z < current.z);
      assert.ok(Math.abs(target.x - current.x) > 1.4);
      horizontalDirections.push(Math.sign(target.x - current.x));
      assert.ok(target.width >= MIN_PLATFORM_WIDTH);
      forceLanding(state);
    }
    assert.equal(horizontalDirections[0], 1);
    assert.ok(horizontalDirections.includes(1));
    assert.ok(horizontalDirections.includes(-1));
  });

  it('uses the target vector for both the charge preview and launch velocity', () => {
    const state = createGame(23);
    const target = targetPlatform(state);
    assert.ok(target);
    const preview = predictedLandingPoint(state, 0.62);
    beginCharge(state, 100);
    releaseJump(state, 100 + CHARGE_MAX_MS * 0.62);
    assert.equal(Math.sign(state.player.vx), Math.sign(target.x - state.player.x));
    assert.ok(state.player.vz < 0);
    const previewDirection = Math.atan2(preview.z - state.player.z, preview.x - state.player.x);
    const launchDirection = Math.atan2(state.player.vz, state.player.vx);
    assert.ok(Math.abs(previewDirection - launchDirection) < 0.001);
  });

  it('makes every safe charge preview land at that same point across platform heights', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const state = createGame(seed);
      const target = targetPlatform(state);
      assert.ok(target);
      let safeRatio;
      let preview;
      for (let step = 0; step <= 200; step += 1) {
        const ratio = step / 200;
        const candidate = predictedLandingPoint(state, ratio);
        if (platformContainsSupport(target, candidate.x, candidate.z, PLAYER_RADIUS)) {
          safeRatio = ratio;
          preview = candidate;
          break;
        }
      }
      assert.notEqual(safeRatio, undefined, `seed ${seed} must offer a reachable safe landing`);
      beginCharge(state, 0);
      releaseJump(state, CHARGE_MAX_MS * safeRatio);
      for (let frame = 0; frame < 360 && state.phase === 'jumping'; frame += 1) {
        stepGame(state, 1 / 240);
      }
      assert.equal(state.phase, 'landed', `seed ${seed} must agree with its safe preview`);
      assert.ok(Math.abs(state.player.x - preview.x) < 0.025);
      assert.ok(Math.abs(state.player.z - preview.z) < 0.025);
    }
  });

  it('requires the complete player support disc to fit inside every platform shape', () => {
    const state = createGame(31);
    const target = targetPlatform(state);
    assert.ok(target);
    for (const shape of ['round', 'square', 'hex', 'diamond']) {
      target.shape = shape;
      target.rotation = 0;
      target.width = 4;
      target.depth = 3.2;
      assert.equal(platformContainsSupport(target, target.x, target.z, PLAYER_RADIUS), true);
      assert.equal(
        platformContainsSupport(target, target.x + target.width / 2 - PLAYER_RADIUS * 0.2, target.z, PLAYER_RADIUS),
        false,
      );
    }
  });

  it('keeps the real safe landing point instead of snapping to the platform center', () => {
    const state = createGame(13);
    const target = targetPlatform(state);
    assert.ok(target);
    target.shape = 'square';
    target.rotation = 0;
    target.width = 4.2;
    target.depth = 3.6;
    forceLanding(state, 0.42, -0.18);
    assert.equal(state.phase, 'landed');
    assert.ok(Math.abs(state.player.x - (target.x + 0.42)) < 0.001);
    assert.ok(Math.abs(state.player.z - (target.z - 0.18)) < 0.001);
    assert.notEqual(state.player.x, target.x);
  });

  it('marks an inside-looking edge contact as a fall instead of a landing', () => {
    const state = createGame(29);
    const target = targetPlatform(state);
    assert.ok(target);
    target.shape = 'square';
    target.rotation = 0;
    target.width = 4;
    target.depth = 3.2;
    forceLanding(state, target.width / 2 - PLAYER_RADIUS * 0.2, 0);
    assert.equal(state.phase, 'jumping');
    assert.equal(state.score, 0);
    assert.equal(state.fallStyle, 'edge');
    assert.equal(state.missedPlatformID, target.id);
    assert.ok(state.fallDirection.x > 0);
  });

  it('lands once while descending and awards the centered bonus once', () => {
    const state = createGame(17);
    forceLanding(state);
    assert.equal(state.phase, 'landed');
    assert.equal(state.score, 2);
    const score = state.score;
    stepGame(state, 1 / 30);
    assert.equal(state.score, score);
  });

  it('spawns a new styled platform at zero animation time after every landing', () => {
    const state = createGame(43);
    const styles = new Set();
    for (let index = 0; index < 10; index += 1) {
      const landed = forceLanding(state);
      styles.add(`${landed.shape}:${landed.material}`);
      const next = targetPlatform(state);
      assert.ok(next);
      assert.equal(next.spawnElapsed, 0);
      assert.ok(next.spawnDuration > 0.4);
    }
    assert.ok(styles.size >= 4);
  });

  it('does not land while rising and enters game over after a clean miss', () => {
    const state = createGame(47);
    const target = targetPlatform(state);
    assert.ok(target);
    state.phase = 'jumping';
    state.player.x = target.x;
    state.player.z = target.z;
    state.player.y = target.top + state.player.radius - 0.01;
    state.player.vy = 1;
    stepGame(state, 1 / 120);
    assert.equal(state.phase, 'jumping');
    state.player.x = target.x + target.width + 3;
    state.player.y = -5;
    state.player.vy = -2.5;
    stepGame(state, 1 / 60);
    assert.equal(state.phase, 'game-over');
  });

  it('restarts from game over and preserves only the session best', () => {
    const state = createGame(19);
    state.phase = 'game-over';
    state.score = 8;
    state.bestScore = 8;
    assert.equal(beginCharge(state, 900), true);
    assert.equal(state.phase, 'charging');
    assert.equal(state.score, 0);
    assert.equal(state.bestScore, 8);
  });
});
