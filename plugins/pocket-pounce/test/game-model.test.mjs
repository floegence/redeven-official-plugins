import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGE_MAX_MS,
  MIN_PLATFORM_WIDTH,
  beginCharge,
  cancelCharge,
  chargeRatio,
  createGame,
  jumpDistanceForCharge,
  releaseJump,
  stepGame,
} from '../ui/src/game-model.ts';

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

  it('generates reachable targets straight ahead without lateral travel', () => {
    const state = createGame(11);
    for (let index = 1; index < state.platforms.length; index += 1) {
      const previous = state.platforms[index - 1];
      const current = state.platforms[index];
      assert.equal(current.x, 0);
      assert.ok(current.z + current.depth / 2 < previous.z - previous.depth / 2);
      assert.ok(current.width >= MIN_PLATFORM_WIDTH);
      const distance = state.player.z - current.z;
      assert.ok(distance >= jumpDistanceForCharge(0));
      assert.ok(distance <= jumpDistanceForCharge(1));
      assert.ok(current.depth > 0);
    }
  });

  it('moves forward through depth and never jumps sideways', () => {
    const state = createGame(23);
    const startZ = state.player.z;
    beginCharge(state, 100);
    releaseJump(state, 720);
    assert.equal(state.player.vx, 0);
    assert.ok(state.player.vz < 0);
    stepGame(state, 0.2);
    assert.equal(state.player.x, 0);
    assert.ok(state.player.z < startZ);
  });

  it('lands once while descending and awards the centered bonus once', () => {
    const state = createGame(13);
    const target = state.platforms[1];
    state.phase = 'jumping';
    state.player.x = target.x;
    state.player.z = target.z;
    state.player.y = target.top + state.player.radius + 0.03;
    state.player.vx = 0;
    state.player.vy = -1.8;
    stepGame(state, 1 / 30);
    assert.equal(state.phase, 'landed');
    assert.equal(state.score, 2);
    const score = state.score;
    stepGame(state, 1 / 30);
    assert.equal(state.score, score);
  });

  it('does not land while rising and enters game over after a miss', () => {
    const state = createGame(17);
    const target = state.platforms[1];
    state.phase = 'jumping';
    state.player.x = target.x;
    state.player.z = target.z;
    state.player.y = target.top + state.player.radius - 0.01;
    state.player.vx = 0;
    state.player.vy = 1;
    stepGame(state, 1 / 120);
    assert.equal(state.phase, 'jumping');
    state.player.z = target.z - target.depth - 2;
    state.player.y = -5;
    state.player.vy = -2.5;
    stepGame(state, 1 / 60);
    assert.equal(state.phase, 'game-over');
  });

  it('requires depth overlap before a descending player can land', () => {
    const state = createGame(29);
    const target = state.platforms[1];
    state.phase = 'jumping';
    state.player.x = target.x + target.width + 2;
    state.player.z = target.z;
    state.player.y = target.top + state.player.radius + 0.03;
    state.player.vx = 0;
    state.player.vy = -1.8;
    state.player.vz = 0;
    stepGame(state, 1 / 30);
    assert.equal(state.phase, 'jumping');
    assert.equal(state.score, 0);
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
