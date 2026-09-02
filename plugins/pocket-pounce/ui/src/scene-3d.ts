import type { GamePhase } from './game-model.js';

export type Vector3Value = Readonly<{ x: number; y: number; z: number }>;

export type CameraTarget = Readonly<{
  position: Vector3Value;
  lookAt: Vector3Value;
}>;

export type SceneMotion = Readonly<{
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  bodyLift: number;
  tilt: number;
  coil: number;
  impact: number;
  cameraShake: number;
  legTuck: number;
}>;

const PLAYER_STANDING_HEIGHT = 0.52;

export function cameraTarget(player: Vector3Value, platformTop: number, forwardAnchorZ = player.z): CameraTarget {
  const airborneHeight = Math.max(0, player.y - (platformTop + PLAYER_STANDING_HEIGHT));
  return {
    position: {
      x: player.x,
      y: platformTop + 10.4 + airborneHeight * 0.52,
      z: forwardAnchorZ + 7.2,
    },
    lookAt: {
      x: player.x,
      y: platformTop + 0.3 + airborneHeight * 0.28,
      z: forwardAnchorZ - 1.8,
    },
  };
}

export function sceneryForwardDistance(index: number, playerZ: number): number {
  return 16 + positiveModulo(index * 13.1 + playerZ, 76);
}

export function dampingAlpha(dtSeconds: number, response = 7): number {
  return 1 - Math.exp(-Math.max(0, dtSeconds) * Math.max(0, response));
}

export function sceneMotion(
  phase: GamePhase,
  charge: number,
  verticalVelocity: number,
  landedElapsed: number,
  nowMs: number,
): SceneMotion {
  const boundedCharge = clamp(charge, 0, 1);
  const breathe = Math.sin(nowMs * 0.006) * 0.018;
  if (phase === 'charging') {
    const tension = easeOutCubic(boundedCharge);
    return {
      scaleX: 1 + tension * 0.18,
      scaleY: 1 - tension * 0.34,
      scaleZ: 1 + tension * 0.14,
      bodyLift: -0.12 * tension + Math.sin(nowMs * 0.045) * tension * 0.018,
      tilt: 0.08 * tension,
      coil: tension,
      impact: 0,
      cameraShake: tension * 0.018,
      legTuck: tension * 0.48,
    };
  }
  if (phase === 'jumping') {
    return {
      scaleX: 0.9,
      scaleY: 1.18,
      scaleZ: 0.94,
      bodyLift: 0,
      tilt: -clamp(verticalVelocity / 12, -0.38, 0.42),
      coil: 0,
      impact: 0,
      cameraShake: 0,
      legTuck: 1,
    };
  }
  if (phase === 'landed') {
    const impact = 1 - clamp(landedElapsed / 0.22, 0, 1);
    const rebound = Math.sin((1 - impact) * Math.PI) * 0.13;
    return {
      scaleX: 1 + impact * 0.3 - rebound * 0.35,
      scaleY: 1 - impact * 0.3 + rebound,
      scaleZ: 1 + impact * 0.22,
      bodyLift: -impact * 0.1 + rebound * 0.12,
      tilt: 0,
      coil: 0,
      impact,
      cameraShake: impact * 0.12,
      legTuck: impact * 0.7,
    };
  }
  return {
    scaleX: 1 - breathe * 0.3,
    scaleY: 1 + breathe,
    scaleZ: 1 - breathe * 0.18,
    bodyLift: Math.max(0, breathe * 0.08),
    tilt: 0,
    coil: 0,
    impact: 0,
    cameraShake: 0,
    legTuck: 0,
  };
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
