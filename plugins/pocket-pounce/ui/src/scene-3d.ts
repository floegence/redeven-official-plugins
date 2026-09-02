import type { FallStyle, GamePhase, Point2 } from './game-model.js';

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
  platformCompression: number;
  fallRoll: number;
}>;

export type PlatformSpawnPose = Readonly<{
  elevation: number;
  scale: number;
  rotation: number;
  glow: number;
  dust: number;
}>;

const PLAYER_STANDING_HEIGHT = 0.52;

export function cameraTarget(
  player: Vector3Value,
  platformTop: number,
  anchor: Point2 = player,
  direction: Point2 = { x: 0.54, z: -0.84 },
): CameraTarget {
  const airborneHeight = Math.max(0, player.y - (platformTop + PLAYER_STANDING_HEIGHT));
  return {
    position: {
      x: anchor.x - direction.x * 0.28,
      y: platformTop + 13.35 + airborneHeight * 0.64,
      z: anchor.z + 8.2,
    },
    lookAt: {
      x: anchor.x + direction.x * 2.5,
      y: platformTop + 0.28 + airborneHeight * 0.28,
      z: anchor.z + direction.z * 2.5,
    },
  };
}

export function platformSpawnPose(elapsed: number, duration: number, turn: number): PlatformSpawnPose {
  const progress = clamp(elapsed / Math.max(0.001, duration), 0, 1);
  const arrival = easeOutCubic(progress);
  const scale = progress >= 1 ? 1 : clamp(0.08 + easeOutBack(progress) * 0.92, 0.08, 1.08);
  return {
    elevation: progress >= 1 ? 0 : -2.45 * (1 - arrival) + Math.sin(progress * Math.PI) * 0.28,
    scale,
    rotation: turn * (1 - arrival) + Math.sin(progress * Math.PI) * 0.08,
    glow: Math.sin(progress * Math.PI) * (0.55 + progress * 0.45),
    dust: Math.sin(clamp(progress * 1.45, 0, 1) * Math.PI),
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
  fallStyle: FallStyle = 'none',
): SceneMotion {
  const boundedCharge = clamp(charge, 0, 1);
  const breathe = Math.sin(nowMs * 0.006) * 0.018;
  if (phase === 'charging') {
    const tension = easeOutCubic(boundedCharge);
    const tremble = Math.sin(nowMs * (0.024 + tension * 0.035)) * tension;
    return {
      scaleX: 1 + tension * 0.22,
      scaleY: 1 - tension * 0.39,
      scaleZ: 1 + tension * 0.18,
      bodyLift: -0.15 * tension + tremble * 0.016,
      tilt: 0.1 * tension,
      coil: tension,
      impact: 0,
      cameraShake: tension * 0.022,
      legTuck: tension * 0.54,
      platformCompression: tension * 0.25,
      fallRoll: 0,
    };
  }
  if (phase === 'jumping') {
    const descending = clamp(-verticalVelocity / 10, 0, 1);
    const fallRoll = fallStyle === 'edge' ? 0.28 + descending * 0.9 : fallStyle === 'clean' ? descending * 0.24 : 0;
    return {
      scaleX: 0.9 + descending * 0.08,
      scaleY: 1.2 - descending * 0.16,
      scaleZ: 0.93 + descending * 0.05,
      bodyLift: 0,
      tilt: -clamp(verticalVelocity / 12, -0.42, 0.44),
      coil: 0,
      impact: 0,
      cameraShake: 0,
      legTuck: 1 - descending * 0.22,
      platformCompression: 0,
      fallRoll,
    };
  }
  if (phase === 'landed') {
    const impact = 1 - clamp(landedElapsed / 0.34, 0, 1);
    const rebound = Math.sin((1 - impact) * Math.PI) * 0.15;
    return {
      scaleX: 1 + impact * 0.34 - rebound * 0.35,
      scaleY: 1 - impact * 0.34 + rebound,
      scaleZ: 1 + impact * 0.26,
      bodyLift: -impact * 0.12 + rebound * 0.15,
      tilt: 0,
      coil: 0,
      impact,
      cameraShake: impact * 0.14,
      legTuck: impact * 0.74,
      platformCompression: impact * 0.18,
      fallRoll: 0,
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
    platformCompression: 0,
    fallRoll: 0,
  };
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeOutBack(value: number): number {
  const overshoot = 1.70158;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
