import type { GamePhase } from './game-model.js';

export type Point3D = Readonly<{ x: number; y: number; z: number }>;
export type ProjectedPoint = Readonly<{ x: number; y: number; scale: number; depth: number }>;

export type SceneMotion = Readonly<{
  scaleX: number;
  scaleY: number;
  stretchY: number;
  bodyLift: number;
  tilt: number;
  coil: number;
  impact: number;
  cameraShake: number;
  legTuck: number;
}>;

const VIEWPORT_CENTER_X = 480;
const VIEWPORT_CENTER_Y = 264;
const CAMERA_Y = 208;
const CAMERA_DISTANCE = 860;
const CAMERA_PITCH = 0.145;
const FOCAL_LENGTH = 875;
const COS_PITCH = Math.cos(CAMERA_PITCH);
const SIN_PITCH = Math.sin(CAMERA_PITCH);

export function projectPoint(point: Point3D, cameraX: number, cameraZ: number): ProjectedPoint {
  const relativeX = point.x - (cameraX + VIEWPORT_CENTER_X);
  const relativeY = point.y - CAMERA_Y;
  const relativeZ = point.z - (cameraZ - CAMERA_DISTANCE);
  const depth = Math.max(280, relativeZ * COS_PITCH + relativeY * SIN_PITCH);
  const viewY = relativeY * COS_PITCH - relativeZ * SIN_PITCH;
  const scale = FOCAL_LENGTH / depth;
  return {
    x: VIEWPORT_CENTER_X + relativeX * scale,
    y: VIEWPORT_CENTER_Y + viewY * scale,
    scale,
    depth,
  };
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
      scaleX: 1 + tension * 0.2,
      scaleY: 1 - tension * 0.32,
      stretchY: 1,
      bodyLift: 8 * tension + Math.sin(nowMs * 0.045) * tension * 1.5,
      tilt: -0.05 * tension,
      coil: tension,
      impact: 0,
      cameraShake: tension * 0.75,
      legTuck: tension * 0.45,
    };
  }
  if (phase === 'jumping') {
    const tilt = clamp(verticalVelocity / 760, -0.58, 0.48);
    return {
      scaleX: 0.91,
      scaleY: 1,
      stretchY: 1.16,
      bodyLift: -3,
      tilt,
      coil: 0,
      impact: 0,
      cameraShake: 0,
      legTuck: 1,
    };
  }
  if (phase === 'landed') {
    const impact = 1 - clamp(landedElapsed / 0.22, 0, 1);
    const rebound = Math.sin((1 - impact) * Math.PI) * 0.12;
    return {
      scaleX: 1 + impact * 0.3 - rebound * 0.4,
      scaleY: 1 - impact * 0.28 + rebound,
      stretchY: 1,
      bodyLift: impact * 5 - rebound * 8,
      tilt: 0,
      coil: 0,
      impact,
      cameraShake: impact * 7,
      legTuck: impact * 0.65,
    };
  }
  return {
    scaleX: 1 - breathe * 0.3,
    scaleY: 1 + breathe,
    stretchY: 1,
    bodyLift: -Math.max(0, breathe * 14),
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
