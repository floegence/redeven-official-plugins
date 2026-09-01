export type GamePhase = 'ready' | 'charging' | 'jumping' | 'landed' | 'game-over';

export type Platform = {
  id: number;
  x: number;
  width: number;
  top: number;
};

export type GameState = {
  phase: GamePhase;
  player: { x: number; y: number; vx: number; vy: number; radius: number };
  platforms: Platform[];
  currentPlatformID: number;
  score: number;
  bestScore: number;
  landings: number;
  chargeStartedAtMs?: number;
  landedElapsed: number;
  cameraTargetX: number;
  seed: number;
  nextPlatformID: number;
};

export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 540;
export const PLAYER_RADIUS = 22;
export const CHARGE_MAX_MS = 1_050;
export const MIN_PLATFORM_WIDTH = 88;
export const MAX_PLATFORM_WIDTH = 156;
const MIN_JUMP_DISTANCE = 240;
const MAX_JUMP_DISTANCE = 480;
const JUMP_DURATION_SECONDS = 1;
const JUMP_VELOCITY_Y = -550;
const GRAVITY = 1_100;
const LANDING_HOLD_SECONDS = 0.22;

export function chargeRatio(elapsedMs: number): number {
  return clamp(elapsedMs / CHARGE_MAX_MS, 0, 1);
}

export function jumpDistanceForCharge(ratio: number): number {
  const bounded = clamp(ratio, 0, 1);
  const eased = bounded * bounded * (3 - 2 * bounded);
  return MIN_JUMP_DISTANCE + (MAX_JUMP_DISTANCE - MIN_JUMP_DISTANCE) * eased;
}

export function createGame(seed = 1): GameState {
  const first: Platform = { id: 1, x: 72, width: 188, top: 414 };
  const state: GameState = {
    phase: 'ready',
    player: {
      x: first.x + first.width * 0.58,
      y: first.top - PLAYER_RADIUS,
      vx: 0,
      vy: 0,
      radius: PLAYER_RADIUS,
    },
    platforms: [first],
    currentPlatformID: first.id,
    score: 0,
    bestScore: 0,
    landings: 0,
    landedElapsed: 0,
    cameraTargetX: 0,
    seed: normalizeSeed(seed),
    nextPlatformID: 2,
  };
  appendReachablePlatform(state);
  return state;
}

export function beginCharge(state: GameState, nowMs: number): boolean {
  if (state.phase === 'game-over') resetRun(state);
  if (state.phase !== 'ready') return false;
  state.phase = 'charging';
  state.chargeStartedAtMs = nowMs;
  return true;
}

export function releaseJump(state: GameState, nowMs: number): boolean {
  if (state.phase !== 'charging' || state.chargeStartedAtMs === undefined) return false;
  const ratio = chargeRatio(nowMs - state.chargeStartedAtMs);
  const distance = jumpDistanceForCharge(ratio);
  state.phase = 'jumping';
  state.chargeStartedAtMs = undefined;
  state.player.vx = distance / JUMP_DURATION_SECONDS;
  state.player.vy = JUMP_VELOCITY_Y;
  return true;
}

export function cancelCharge(state: GameState): boolean {
  if (state.phase !== 'charging') return false;
  state.phase = 'ready';
  state.chargeStartedAtMs = undefined;
  state.player.vx = 0;
  state.player.vy = 0;
  return true;
}

export function stepGame(state: GameState, dtSeconds: number): void {
  const dt = clamp(dtSeconds, 0, 0.05);
  if (state.phase === 'landed') {
    state.landedElapsed += dt;
    if (state.landedElapsed >= LANDING_HOLD_SECONDS) {
      state.landedElapsed = 0;
      state.phase = 'ready';
    }
    return;
  }
  if (state.phase !== 'jumping') return;

  const previousBottom = state.player.y + state.player.radius;
  state.player.x += state.player.vx * dt;
  state.player.y += state.player.vy * dt + GRAVITY * dt * dt * 0.5;
  state.player.vy += GRAVITY * dt;
  const nextBottom = state.player.y + state.player.radius;

  if (state.player.vy > 0) {
    const landed = state.platforms
      .filter((platform) => platform.id !== state.currentPlatformID)
      .find((platform) => previousBottom <= platform.top && nextBottom >= platform.top && horizontalOverlap(state, platform));
    if (landed) {
      landOnPlatform(state, landed);
      return;
    }
  }

  if (state.player.y - state.player.radius > WORLD_HEIGHT) {
    state.phase = 'game-over';
    state.player.vx = 0;
    state.bestScore = Math.max(state.bestScore, state.score);
  }
}

export function platformWidthForLandings(landings: number): number {
  return Math.max(MIN_PLATFORM_WIDTH, MAX_PLATFORM_WIDTH - Math.floor(Math.max(0, landings) / 5) * 10);
}

function horizontalOverlap(state: GameState, platform: Platform): boolean {
  const inset = state.player.radius * 0.42;
  return state.player.x + inset >= platform.x && state.player.x - inset <= platform.x + platform.width;
}

function landOnPlatform(state: GameState, platform: Platform): void {
  const center = platform.x + platform.width / 2;
  const centered = Math.abs(state.player.x - center) <= platform.width * 0.18;
  state.player.y = platform.top - state.player.radius;
  state.player.vx = 0;
  state.player.vy = 0;
  state.phase = 'landed';
  state.landedElapsed = 0;
  state.currentPlatformID = platform.id;
  state.landings += 1;
  state.score += centered ? 2 : 1;
  state.bestScore = Math.max(state.bestScore, state.score);
  state.cameraTargetX = Math.max(0, state.player.x - 260);
  state.platforms = state.platforms.filter((candidate) => candidate.x + candidate.width >= platform.x - 300);
  appendReachablePlatform(state);
}

function appendReachablePlatform(state: GameState): void {
  const previous = state.platforms.at(-1)!;
  const width = platformWidthForLandings(state.landings);
  const random = nextRandom(state);
  const minDistance = jumpDistanceForCharge(0) + 18;
  const maxDistance = jumpDistanceForCharge(1) - 18;
  const centerDistance = minDistance + (maxDistance - minDistance) * random;
  let x = state.player.x + centerDistance - width / 2;
  x = Math.max(x, previous.x + previous.width + 46);
  state.platforms.push({ id: state.nextPlatformID, x, width, top: 414 });
  state.nextPlatformID += 1;
}

function resetRun(state: GameState): void {
  const bestScore = Math.max(state.bestScore, state.score);
  const fresh = createGame(state.seed ^ 0x9e3779b9);
  fresh.bestScore = bestScore;
  Object.assign(state, fresh);
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
