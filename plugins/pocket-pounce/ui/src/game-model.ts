export type GamePhase = 'ready' | 'charging' | 'jumping' | 'landed' | 'game-over';
export type TravelDirection = 'right' | 'left';
export type PlatformShape = 'round' | 'square' | 'hex' | 'diamond';
export type PlatformMaterial = 'sandstone' | 'slate' | 'moonstone' | 'copper';
export type FallStyle = 'none' | 'edge' | 'clean';

export type Point2 = Readonly<{ x: number; z: number }>;

export type Platform = {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  top: number;
  height: number;
  shape: PlatformShape;
  material: PlatformMaterial;
  rotation: number;
  spawnElapsed: number;
  spawnDuration: number;
};

export type GameState = {
  phase: GamePhase;
  player: { x: number; y: number; z: number; vx: number; vy: number; vz: number; radius: number };
  platforms: Platform[];
  currentPlatformID: number;
  targetPlatformID: number;
  score: number;
  bestScore: number;
  landings: number;
  chargeStartedAtMs?: number;
  landedElapsed: number;
  impactSpeed: number;
  routeDirection: TravelDirection;
  routeRunRemaining: number;
  fallStyle: FallStyle;
  fallDirection: Point2;
  missedPlatformID?: number;
  seed: number;
  nextPlatformID: number;
};

export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 540;
export const PLAYER_RADIUS = 0.52;
export const CHARGE_MAX_MS = 1_050;
export const MIN_PLATFORM_WIDTH = 2.25;
export const MAX_PLATFORM_WIDTH = 3.9;
export const JUMP_DURATION_SECONDS = 0.92;
const MIN_JUMP_DISTANCE = 4.4;
const MAX_JUMP_DISTANCE = 8.3;
const GRAVITY = -18;
const JUMP_VELOCITY_Y = -GRAVITY * JUMP_DURATION_SECONDS * 0.5;
const LANDING_HOLD_SECONDS = 0.48;
const FALL_LIMIT = -4.5;
const SHAPES: readonly PlatformShape[] = ['round', 'square', 'hex', 'diamond'];
const MATERIALS: readonly PlatformMaterial[] = ['sandstone', 'slate', 'moonstone', 'copper'];

export function chargeRatio(elapsedMs: number): number {
  return clamp(elapsedMs / CHARGE_MAX_MS, 0, 1);
}

export function jumpDistanceForCharge(ratio: number): number {
  const bounded = clamp(ratio, 0, 1);
  const eased = bounded * bounded * (3 - 2 * bounded);
  return MIN_JUMP_DISTANCE + (MAX_JUMP_DISTANCE - MIN_JUMP_DISTANCE) * eased;
}

export function createGame(seed = 1): GameState {
  const first: Platform = {
    id: 1,
    x: -2.35,
    z: 0,
    width: 4.9,
    depth: 3.7,
    top: 0,
    height: 1.22,
    shape: 'round',
    material: 'sandstone',
    rotation: 0,
    spawnElapsed: 1,
    spawnDuration: 0.64,
  };
  const state: GameState = {
    phase: 'ready',
    player: {
      x: first.x,
      y: first.top + PLAYER_RADIUS,
      z: first.z,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: PLAYER_RADIUS,
    },
    platforms: [first],
    currentPlatformID: first.id,
    targetPlatformID: 0,
    score: 0,
    bestScore: 0,
    landings: 0,
    landedElapsed: 0,
    impactSpeed: 0,
    routeDirection: 'right',
    routeRunRemaining: 3,
    fallStyle: 'none',
    fallDirection: { x: 0, z: 0 },
    seed: normalizeSeed(seed),
    nextPlatformID: 2,
  };
  appendReachablePlatform(state);
  return state;
}

export function targetPlatform(state: GameState): Platform | undefined {
  return state.platforms.find((platform) => platform.id === state.targetPlatformID);
}

export function courseDirection(state: GameState): Point2 {
  const target = targetPlatform(state);
  if (!target) return state.routeDirection === 'right' ? { x: 0.54, z: -0.84 } : { x: -0.54, z: -0.84 };
  const dx = target.x - state.player.x;
  const dz = target.z - state.player.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

export function predictedLandingPoint(state: GameState, ratio: number): Point2 {
  const direction = courseDirection(state);
  const target = targetPlatform(state);
  const landingDuration = target
    ? descendingCrossingTime(state.player.y - state.player.radius, target.top)
    : JUMP_DURATION_SECONDS;
  const speed = jumpDistanceForCharge(ratio) / JUMP_DURATION_SECONDS;
  const distance = speed * landingDuration;
  return {
    x: state.player.x + direction.x * distance,
    z: state.player.z + direction.z * distance,
  };
}

export function beginCharge(state: GameState, nowMs: number): boolean {
  if (state.phase === 'game-over') resetRun(state);
  if (state.phase !== 'ready') return false;
  state.phase = 'charging';
  state.chargeStartedAtMs = nowMs;
  state.fallStyle = 'none';
  state.missedPlatformID = undefined;
  return true;
}

export function releaseJump(state: GameState, nowMs: number): boolean {
  if (state.phase !== 'charging' || state.chargeStartedAtMs === undefined) return false;
  const ratio = chargeRatio(nowMs - state.chargeStartedAtMs);
  const direction = courseDirection(state);
  const speed = jumpDistanceForCharge(ratio) / JUMP_DURATION_SECONDS;
  state.phase = 'jumping';
  state.chargeStartedAtMs = undefined;
  state.player.vx = direction.x * speed;
  state.player.vy = JUMP_VELOCITY_Y;
  state.player.vz = direction.z * speed;
  state.fallStyle = 'none';
  state.fallDirection = { x: 0, z: 0 };
  state.missedPlatformID = undefined;
  return true;
}

export function cancelCharge(state: GameState): boolean {
  if (state.phase !== 'charging') return false;
  state.phase = 'ready';
  state.chargeStartedAtMs = undefined;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.vz = 0;
  return true;
}

export function stepGame(state: GameState, dtSeconds: number): void {
  const dt = clamp(dtSeconds, 0, 0.05);
  for (const platform of state.platforms) {
    platform.spawnElapsed = Math.min(platform.spawnDuration, platform.spawnElapsed + dt);
  }
  if (state.phase === 'landed') {
    state.landedElapsed += dt;
    if (state.landedElapsed >= LANDING_HOLD_SECONDS) {
      state.landedElapsed = 0;
      state.phase = 'ready';
    }
    return;
  }
  if (state.phase !== 'jumping') return;

  const previous = { x: state.player.x, y: state.player.y, z: state.player.z };
  const previousBottom = previous.y - state.player.radius;
  state.player.x += state.player.vx * dt;
  state.player.y += state.player.vy * dt + GRAVITY * dt * dt * 0.5;
  state.player.z += state.player.vz * dt;
  state.player.vy += GRAVITY * dt;
  const nextBottom = state.player.y - state.player.radius;

  const target = targetPlatform(state);
  if (target && state.player.vy < 0 && previousBottom >= target.top && nextBottom <= target.top) {
    const descent = previousBottom - nextBottom;
    const crossing = descent > 0 ? clamp((previousBottom - target.top) / descent, 0, 1) : 1;
    const landingX = previous.x + (state.player.x - previous.x) * crossing;
    const landingZ = previous.z + (state.player.z - previous.z) * crossing;
    if (platformContainsSupport(target, landingX, landingZ, state.player.radius)) {
      landOnPlatform(state, target, landingX, landingZ);
      return;
    }
    if (platformContainsPoint(target, landingX, landingZ)) {
      markEdgeFall(state, target, landingX, landingZ);
    } else if (state.fallStyle === 'none') {
      state.fallStyle = 'clean';
    }
  }

  if (state.player.y + state.player.radius < FALL_LIMIT) {
    state.phase = 'game-over';
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.vz = 0;
    state.bestScore = Math.max(state.bestScore, state.score);
  }
}

export function platformWidthForLandings(landings: number): number {
  return Math.max(MIN_PLATFORM_WIDTH, MAX_PLATFORM_WIDTH - Math.floor(Math.max(0, landings) / 5) * 0.22);
}

export function platformFootprint(platform: Platform): Point2[] {
  const halfWidth = platform.width * 0.5;
  const halfDepth = platform.depth * 0.5;
  let local: Point2[];
  if (platform.shape === 'square') {
    local = [
      { x: -halfWidth, z: -halfDepth },
      { x: halfWidth, z: -halfDepth },
      { x: halfWidth, z: halfDepth },
      { x: -halfWidth, z: halfDepth },
    ];
  } else if (platform.shape === 'diamond') {
    local = [
      { x: 0, z: -halfDepth },
      { x: halfWidth, z: 0 },
      { x: 0, z: halfDepth },
      { x: -halfWidth, z: 0 },
    ];
  } else {
    const segments = platform.shape === 'hex' ? 6 : 20;
    local = Array.from({ length: segments }, (_, index) => {
      const angle = -Math.PI * 0.5 + (index / segments) * Math.PI * 2;
      return { x: Math.cos(angle) * halfWidth, z: Math.sin(angle) * halfDepth };
    });
  }
  const cosine = Math.cos(platform.rotation);
  const sine = Math.sin(platform.rotation);
  return local.map((point) => ({
    x: platform.x + point.x * cosine - point.z * sine,
    z: platform.z + point.x * sine + point.z * cosine,
  }));
}

export function platformContainsPoint(platform: Platform, x: number, z: number): boolean {
  return pointInsideConvex(platformFootprint(platform), { x, z });
}

export function platformContainsSupport(platform: Platform, x: number, z: number, radius: number): boolean {
  const footprint = platformFootprint(platform);
  const point = { x, z };
  if (!pointInsideConvex(footprint, point)) return false;
  const clearance = footprint.reduce((minimum, start, index) => {
    const end = footprint[(index + 1) % footprint.length];
    return Math.min(minimum, distanceToSegment(point, start, end));
  }, Number.POSITIVE_INFINITY);
  return clearance >= Math.max(0, radius);
}

function landOnPlatform(state: GameState, platform: Platform, landingX: number, landingZ: number): void {
  const centered = Math.hypot(landingX - platform.x, landingZ - platform.z)
    <= Math.min(platform.width, platform.depth) * 0.14;
  state.impactSpeed = Math.abs(state.player.vy);
  state.player.x = landingX;
  state.player.y = platform.top + state.player.radius;
  state.player.z = landingZ;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.vz = 0;
  state.phase = 'landed';
  state.landedElapsed = 0;
  state.currentPlatformID = platform.id;
  state.landings += 1;
  state.score += centered ? 2 : 1;
  state.bestScore = Math.max(state.bestScore, state.score);
  state.fallStyle = 'none';
  state.fallDirection = { x: 0, z: 0 };
  state.missedPlatformID = undefined;
  state.platforms = state.platforms.filter((candidate) => candidate.id === platform.id || candidate.z <= platform.z + 10);
  advanceRoute(state);
  appendReachablePlatform(state);
}

function markEdgeFall(state: GameState, platform: Platform, landingX: number, landingZ: number): void {
  if (state.missedPlatformID !== undefined) return;
  const dx = landingX - platform.x;
  const dz = landingZ - platform.z;
  const length = Math.hypot(dx, dz) || 1;
  state.fallStyle = 'edge';
  state.fallDirection = { x: dx / length, z: dz / length };
  state.missedPlatformID = platform.id;
}

function advanceRoute(state: GameState): void {
  state.routeRunRemaining -= 1;
  const current = state.platforms.find((platform) => platform.id === state.currentPlatformID);
  const reachedOuterLane = current ? Math.abs(current.x) > 7.2 : false;
  if (state.routeRunRemaining > 0 && !reachedOuterLane) return;
  state.routeDirection = state.routeDirection === 'right' ? 'left' : 'right';
  state.routeRunRemaining = 2 + Math.floor(nextRandom(state) * 3);
}

function appendReachablePlatform(state: GameState): void {
  const current = state.platforms.find((platform) => platform.id === state.currentPlatformID);
  if (!current) return;
  const baseWidth = platformWidthForLandings(state.landings);
  const width = Math.max(MIN_PLATFORM_WIDTH, baseWidth * (0.9 + nextRandom(state) * 0.14));
  const depth = Math.max(2.15, width * (0.72 + nextRandom(state) * 0.15));
  const top = -0.08 + nextRandom(state) * 0.2;
  const landingDuration = descendingCrossingTime(current.top, top);
  const durationScale = landingDuration / JUMP_DURATION_SECONDS;
  const minimum = jumpDistanceForCharge(0) * durationScale;
  const maximum = jumpDistanceForCharge(1) * durationScale;
  const distance = minimum + 0.65 + (maximum - minimum - 1.3) * nextRandom(state);
  const lateralRatio = 0.4 + nextRandom(state) * 0.14;
  const horizontalSign = state.routeDirection === 'right' ? 1 : -1;
  const deltaX = horizontalSign * distance * lateralRatio;
  const deltaZ = -Math.sqrt(Math.max(0.1, distance * distance - deltaX * deltaX));
  const id = state.nextPlatformID;
  const shape = SHAPES[(id - 2) % SHAPES.length];
  const material = MATERIALS[(id + Math.floor(nextRandom(state) * MATERIALS.length)) % MATERIALS.length];
  const platform: Platform = {
    id,
    x: current.x + deltaX,
    z: current.z + deltaZ,
    width,
    depth,
    top,
    height: 0.9 + nextRandom(state) * 0.55,
    shape,
    material,
    rotation: (nextRandom(state) - 0.5) * 0.72,
    spawnElapsed: 0,
    spawnDuration: 0.56 + nextRandom(state) * 0.18,
  };
  state.platforms.push(platform);
  state.targetPlatformID = id;
  state.nextPlatformID += 1;
}

function resetRun(state: GameState): void {
  const bestScore = Math.max(state.bestScore, state.score);
  const fresh = createGame(state.seed ^ 0x9e3779b9);
  fresh.bestScore = bestScore;
  Object.assign(state, fresh);
}

function descendingCrossingTime(startTop: number, targetTop: number): number {
  const heightDifference = startTop - targetTop;
  const discriminant = JUMP_VELOCITY_Y * JUMP_VELOCITY_Y - 2 * GRAVITY * heightDifference;
  if (discriminant <= 0) return JUMP_DURATION_SECONDS;
  return (-JUMP_VELOCITY_Y - Math.sqrt(discriminant)) / GRAVITY;
}

function pointInsideConvex(vertices: readonly Point2[], point: Point2): boolean {
  let sign = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const cross = (end.x - start.x) * (point.z - start.z) - (end.z - start.z) * (point.x - start.x);
    if (Math.abs(cross) <= 1e-9) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

function distanceToSegment(point: Point2, start: Point2, end: Point2): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-9) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

function nextRandom(state: GameState): number {
  let value = state.seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.seed = normalizeSeed(value);
  return (state.seed >>> 0) / 0x1_0000_0000;
}

function normalizeSeed(seed: number): number {
  const normalized = Number.isFinite(seed) ? seed | 0 : 1;
  return normalized === 0 ? 1 : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
