import {
  PluginBridgeClient,
  type PluginCanvasInputEvent,
} from '@floegence/redevplugin-ui/plugin';
import {
  PLAYER_RADIUS,
  beginCharge,
  cancelCharge,
  chargeRatio,
  createGame,
  jumpDistanceForCharge,
  releaseJump,
  stepGame,
  type GamePhase,
  type Platform,
} from './game-model.js';
import { canvasBackingSize } from './canvas-backing.js';
import { cameraTarget, dampingAlpha, sceneryForwardDistance, sceneMotion } from './scene-3d.js';
import {
  buildCylinderFaces,
  buildEllipsoidFaces,
  dot,
  faceNormal,
  projectPoint,
  shadeColor,
  sortFacesBackToFront,
  type Camera3D,
  type MeshFace,
  type Vec3,
} from './software-3d.js';

type Locale = 'en-US' | 'zh-CN';
type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
};
type MutableCamera = {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fovDegrees: number;
};

const copy = {
  'en-US': {
    score: 'SCORE', best: 'BEST', ready: 'HOLD SPACE TO CHARGE',
    release: 'RELEASE TO POUNCE FORWARD', ended: 'LOST IN THE DUNES', again: 'HOLD SPACE TO HOP AGAIN',
    keyboard: 'Keyboard required', exact: 'CENTER +2', controls: 'Hold Space · Release to jump forward',
    label: 'Pocket Pounce forward three-dimensional game canvas',
  },
  'zh-CN': {
    score: '得分', best: '最佳', ready: '按住空格蓄力',
    release: '松开空格向前跃出', ended: '掉进沙丘啦', again: '按住空格重新开始',
    keyboard: '需要键盘操作', exact: '中心落点 +2', controls: '按住空格蓄力 · 松开向前跳跃',
    label: '跃跃小跳鼠前进式三维游戏画布',
  },
} as const;

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const game = createGame(Date.now());
const particles: Particle[] = [];
const MAX_PARTICLES = 64;
const FIXED_STEP = 1 / 120;
const LIGHT_DIRECTION = normalize({ x: -0.45, y: 0.86, z: 0.34 });
const STAR_FIELD = Array.from({ length: 88 }, (_, index) => ({
  x: ((index * 47) % 101) / 101,
  y: ((index * 61) % 71) / 71,
  radius: 0.45 + ((index * 29) % 17) / 15,
  phase: (index * 0.79) % (Math.PI * 2),
}));

let locale: Locale = 'en-US';
let canvas: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
let cssWidth = 960;
let cssHeight = 540;
let backingWidth = 960;
let backingHeight = 540;
let lastFrameAt = 0;
let accumulator = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let surfaceVisible = true;
let disposed = false;
let ready = false;
let lastPhase: GamePhase = game.phase;
let lastScore = game.score;
let awardText = '';
let awardLife = 0;
let launchRingLife = 0;
let landingRingLife = 0;
let launchRingZ = 0;
let landingRingZ = 0;
let particleSequence = 0;
let accessibilitySignature = '';
let accessibilityInFlight: Promise<void> | undefined;
const camera: MutableCamera = {
  position: { x: 0, y: 10.4, z: 7.2 },
  lookAt: { x: 0, y: 0.3, z: -1.8 },
  fovDegrees: 38,
};

bridge.onCanvasInput('playfield', handleInput);
bridge.onLifecycle((event) => {
  if (event.type === 'hidden') {
    surfaceVisible = false;
    cancelCharge(game);
    stopFrameLoop();
    particles.length = 0;
    syncAccessibility(true);
    return;
  }
  if (event.type === 'visible') {
    surfaceVisible = true;
    lastFrameAt = performance.now();
    accumulator = 0;
    scheduleFrame();
    syncAccessibility(true);
    return;
  }
  if (event.type === 'dispose') {
    disposed = true;
    surfaceVisible = false;
    cancelCharge(game);
    stopFrameLoop();
    particles.length = 0;
    ready = false;
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
});

void initialize().catch(showFatalError);

async function initialize(): Promise<void> {
  await bridge.ready();
  bridge.onContext((value) => {
    locale = value.locale.language_tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
    syncAccessibility(true);
  });
  await bridge.render(
    <main key="pocket-pounce-root" className="game-shell">
      <canvas
        key="pocket-pounce-playfield"
        data-redevplugin-canvas="playfield"
        width={960}
        height={540}
        tabindex={0}
        autofocus
        aria-label="Pocket Pounce forward three-dimensional game canvas"
      />
    </main>,
  );
  const surface = await bridge.openCanvas('playfield');
  canvas = surface.canvas;
  const nextContext = canvas.getContext('2d');
  if (!nextContext) throw new Error('Canvas2D is unavailable');
  context = nextContext;
  configureCanvas(surface.cssWidth, surface.cssHeight, surface.devicePixelRatio);
  const initialTarget = cameraTarget(game.player, 0);
  Object.assign(camera.position, initialTarget.position);
  Object.assign(camera.lookAt, initialTarget.lookAt);
  ready = true;
  lastFrameAt = performance.now();
  syncAccessibility(true);
  scheduleFrame();
}

async function showFatalError(): Promise<void> {
  try {
    await bridge.ready();
    await bridge.render(
      <main key="pocket-pounce-error" className="game-shell game-error" role="alert">
        <div key="pocket-pounce-error-card" className="error-card">
          <strong key="pocket-pounce-error-title">Pocket Pounce</strong>
          <p key="pocket-pounce-error-copy">The 3D game could not start. Reopen the plugin to try again.</p>
        </div>
      </main>,
    );
  } catch {
    // The host owns the unavailable state when the bridge itself cannot start.
  }
}

function handleInput(event: PluginCanvasInputEvent): void {
  if (event.type === 'resize') {
    configureCanvas(event.cssWidth, event.cssHeight, event.devicePixelRatio);
    return;
  }
  if (event.type === 'blur') {
    cancelCharge(game);
    syncAccessibility(true);
    return;
  }
  if (event.type !== 'key' || event.code !== 'Space') return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.event === 'keydown') {
    if (!event.repeat) beginCharge(game, performance.now());
  } else {
    releaseJump(game, performance.now());
  }
  syncAccessibility(true);
}

function configureCanvas(width: number, height: number, nextPixelRatio: number): void {
  cssWidth = Math.max(1, width);
  cssHeight = Math.max(1, height);
  const backing = canvasBackingSize(cssWidth, cssHeight, nextPixelRatio);
  backingWidth = backing.width;
  backingHeight = backing.height;
  if (canvas) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
}

function scheduleFrame(): void {
  if (!ready || disposed || !surfaceVisible || frameTimer !== undefined) return;
  frameTimer = setTimeout(() => {
    frameTimer = undefined;
    frame();
  }, 1000 / 60);
}

function stopFrameLoop(): void {
  if (frameTimer !== undefined) clearTimeout(frameTimer);
  frameTimer = undefined;
}

function frame(): void {
  if (!ready || disposed || !surfaceVisible) return;
  const now = performance.now();
  const elapsed = clamp((now - lastFrameAt) / 1000, 0, 0.05);
  lastFrameAt = now;
  accumulator = Math.min(0.1, accumulator + elapsed);
  while (accumulator >= FIXED_STEP) {
    stepGame(game, FIXED_STEP);
    accumulator -= FIXED_STEP;
  }
  observeGameTransitions();
  updateParticles(elapsed);
  updateCamera(now, elapsed);
  renderWorld(now);
  drawHUD(now);
  syncAccessibility(false);
  scheduleFrame();
}

function observeGameTransitions(): void {
  if (lastPhase === 'charging' && game.phase === 'jumping') {
    launchRingZ = game.player.z;
    launchRingLife = 0.42;
    spawnDust(14, 0.86);
  }
  if (lastPhase === 'jumping' && game.phase === 'landed') {
    const gained = game.score - lastScore;
    awardText = gained === 2 ? copy[locale].exact : '+1';
    awardLife = 0.9;
    landingRingZ = game.player.z;
    landingRingLife = 0.58;
    spawnDust(26, 1.08);
  }
  lastPhase = game.phase;
  lastScore = game.score;
}

function updateCamera(nowMs: number, elapsed: number): void {
  const currentPlatform = currentPlatformForPlayer();
  const forwardAnchorZ = game.phase === 'jumping' ? currentPlatform?.z ?? game.player.z : game.player.z;
  const desired = cameraTarget(game.player, currentPlatform?.top ?? 0, forwardAnchorZ);
  const follow = dampingAlpha(elapsed, game.phase === 'jumping' ? 8.5 : 6.2);
  camera.position.x += (desired.position.x - camera.position.x) * follow;
  camera.position.y += (desired.position.y - camera.position.y) * follow;
  camera.position.z += (desired.position.z - camera.position.z) * follow;
  camera.lookAt.x += (desired.lookAt.x - camera.lookAt.x) * follow;
  camera.lookAt.y += (desired.lookAt.y - camera.lookAt.y) * follow;
  camera.lookAt.z += (desired.lookAt.z - camera.lookAt.z) * follow;
  const motion = currentMotion(nowMs);
  if (motion.cameraShake > 0) {
    camera.position.x += Math.sin(nowMs * 0.085) * motion.cameraShake;
    camera.position.y += Math.cos(nowMs * 0.11) * motion.cameraShake * 0.55;
  }
  launchRingLife = Math.max(0, launchRingLife - elapsed);
  landingRingLife = Math.max(0, landingRingLife - elapsed);
  awardLife = Math.max(0, awardLife - elapsed);
}

function renderWorld(nowMs: number): void {
  const scaleX = backingWidth / cssWidth;
  const scaleY = backingHeight / cssHeight;
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawSky(nowMs);
  drawGround();
  drawMoon();
  drawGroundGrid();
  drawPlayerShadow();

  const worldFaces: MeshFace[] = [];
  appendSceneryFaces(worldFaces);
  appendPlatformFaces(worldFaces, nowMs);
  drawFaces(worldFaces);
  drawLandingGuides(nowMs);

  drawJerboaTail(nowMs);
  const playerFaces: MeshFace[] = [];
  appendJerboaFaces(playerFaces, nowMs);
  drawFaces(playerFaces);
  drawSpeedLines(nowMs);
  drawDust();
}

function drawSky(nowMs: number): void {
  const sky = context.createLinearGradient(0, 0, 0, cssHeight * 0.38);
  sky.addColorStop(0, '#071329');
  sky.addColorStop(0.55, '#292846');
  sky.addColorStop(1, '#925b4c');
  context.fillStyle = sky;
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.save();
  for (const star of STAR_FIELD) {
    const x = positiveModulo(star.x * cssWidth + camera.position.z * star.radius * 0.18, cssWidth);
    const y = 8 + star.y * cssHeight * 0.26 - (camera.position.y - 10.4) * star.radius * 1.2;
    const alpha = 0.34 + Math.sin(nowMs * 0.0015 + star.phase) * 0.18;
    context.globalAlpha = alpha;
    context.fillStyle = '#ffe9bd';
    context.beginPath();
    context.arc(x, y, star.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawGround(): void {
  const horizon = groundHorizon();
  const ground = context.createLinearGradient(0, horizon, 0, cssHeight);
  ground.addColorStop(0, '#5e4148');
  ground.addColorStop(0.45, '#75484a');
  ground.addColorStop(1, '#3a2734');
  context.fillStyle = ground;
  context.fillRect(0, horizon, cssWidth, cssHeight - horizon);
  const haze = context.createLinearGradient(0, horizon - 24, 0, horizon + 42);
  haze.addColorStop(0, '#d38c7150');
  haze.addColorStop(1, '#8f5c4a00');
  context.fillStyle = haze;
  context.fillRect(0, horizon - 24, cssWidth, 72);
}

function drawMoon(): void {
  const point = projectPoint({ x: 8, y: 15.5, z: game.player.z - 42 }, camera, cssWidth, cssHeight);
  if (!point) return;
  const radius = clamp(point.scale * 1.55, 12, 38);
  const glow = context.createRadialGradient(point.x, point.y, radius * 0.12, point.x, point.y, radius * 2.7);
  glow.addColorStop(0, '#fff8dd');
  glow.addColorStop(0.38, '#ffe0a8d9');
  glow.addColorStop(1, '#ffd59800');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(point.x, point.y, radius * 2.7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffe5ad';
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawGroundGrid(): void {
  context.save();
  context.beginPath();
  context.rect(0, groundHorizon(), cssWidth, cssHeight);
  context.clip();
  context.strokeStyle = '#f2b37c24';
  context.lineWidth = 1;
  for (let x = -18; x <= 18; x += 3) {
    drawWorldLine({ x, y: -1.28, z: game.player.z + 8 }, { x, y: -1.28, z: game.player.z - 100 });
  }
  for (let distance = 2; distance <= 96; distance += 5) {
    drawWorldLine(
      { x: -20, y: -1.28, z: game.player.z - distance },
      { x: 20, y: -1.28, z: game.player.z - distance },
    );
  }
  context.restore();
}

function drawLandingGuides(nowMs: number): void {
  const target = nextTargetPlatform();
  if (target) {
    const pulse = 1 + Math.sin(nowMs * 0.006) * 0.08;
    let color = '#ffe5a2';
    let alpha = 0.72;
    let lineWidth = 2.2;
    if (game.phase === 'charging' && game.chargeStartedAtMs !== undefined) {
      const ratio = chargeRatio(nowMs - game.chargeStartedAtMs);
      const predictedZ = game.player.z - jumpDistanceForCharge(ratio);
      const withinTarget = Math.abs(predictedZ - target.z) <= target.depth * 0.45;
      color = withinTarget ? '#bdf6c7' : '#ff9e79';
      alpha = 0.92;
      lineWidth = 3;
    }
    drawWorldRing(
      { x: target.x, y: target.top + 0.055, z: target.z },
      target.width * 0.24 * pulse,
      target.depth * 0.24 * pulse,
      color,
      alpha,
      lineWidth,
    );
  }
  if (launchRingLife > 0) {
    const progress = 1 - launchRingLife / 0.42;
    drawWorldRing({ x: 0, y: 0.04, z: launchRingZ }, 0.52 + progress * 1.8, 0.36 + progress * 1.2, '#f6b66f', launchRingLife / 0.42, 3);
  }
  if (landingRingLife > 0) {
    const progress = 1 - landingRingLife / 0.58;
    drawWorldRing({ x: 0, y: 0.045, z: landingRingZ }, 0.58 + progress * 2.4, 0.4 + progress * 1.5, '#fff0bd', landingRingLife / 0.58, 3.4);
  }
}

function drawPlayerShadow(): void {
  const platform = currentPlatformForPlayer();
  const top = platform?.top ?? 0;
  const airborne = Math.max(0, game.player.y - PLAYER_RADIUS - top);
  const scale = clamp(1 - airborne / 6, 0.3, 1);
  const points = ellipseWorldPoints({ x: game.player.x, y: top + 0.03, z: game.player.z }, 0.68 * scale, 0.43 * scale, 28);
  const projected = points.map((point) => projectPoint(point, camera, cssWidth, cssHeight)).filter(isProjected);
  if (projected.length < 3) return;
  context.save();
  context.globalAlpha = 0.17 + scale * 0.18;
  context.fillStyle = '#120f1d';
  pathProjected(projected);
  context.fill();
  context.restore();
}

function appendSceneryFaces(faces: MeshFace[]): void {
  for (let index = 0; index < 9; index += 1) {
    const z = game.player.z - sceneryForwardDistance(index, game.player.z);
    const side = index % 2 === 0 ? -1 : 1;
    const size = 1.05 + (index % 3) * 0.38;
    faces.push(...buildEllipsoidFaces(
      { x: side * (10.5 + (index % 3) * 3.4), y: -1.0 + size * 0.08, z },
      { x: size * 2.1, y: size * 0.4, z: size * 1.35 },
      3,
      6,
      index % 3 === 0 ? '#40374a' : '#754850',
      { y: index * 0.47, z: side * 0.08 },
    ));
  }
}

function groundHorizon(): number {
  const far = projectPoint({ x: 0, y: -1.32, z: game.player.z - 95 }, camera, cssWidth, cssHeight);
  return clamp(far?.y ?? cssHeight * 0.24, cssHeight * 0.18, cssHeight * 0.34);
}

function appendPlatformFaces(faces: MeshFace[], nowMs: number): void {
  const motion = currentMotion(nowMs);
  for (const platform of game.platforms) {
    const impact = platform.id === game.currentPlatformID && game.phase === 'landed' ? motion.impact : 0;
    const chargeCompression = platform.id === game.currentPlatformID && game.phase === 'charging' ? motion.coil : 0;
    const height = 1.04 * (1 - chargeCompression * 0.22 - impact * 0.16);
    const visualTop = platform.top - chargeCompression * 0.16 - impact * 0.07;
    faces.push(...buildCylinderFaces(
      { x: platform.x, y: visualTop - height * 0.5, z: platform.z },
      platform.width * 0.5,
      platform.depth * 0.5,
      height,
      8,
      '#d99a6f',
      platform.id % 2 === 0 ? '#9d5a54' : '#844a50',
    ));
  }
}

function appendJerboaFaces(faces: MeshFace[], nowMs: number): void {
  const motion = currentMotion(nowMs);
  const base = game.player.y - PLAYER_RADIUS + motion.bodyLift;
  const tilt = motion.tilt;
  const xScale = motion.scaleX;
  const yScale = motion.scaleY;
  const zScale = motion.scaleZ;
  const bodyCenter = { x: game.player.x, y: base + 0.63 * yScale, z: game.player.z };
  faces.push(...buildEllipsoidFaces(bodyCenter, { x: 0.44 * xScale, y: 0.58 * yScale, z: 0.54 * zScale }, 5, 8, '#cf725f', { x: tilt }));
  faces.push(...buildEllipsoidFaces(
    { x: game.player.x, y: base + 1.14 * yScale, z: game.player.z - 0.43 },
    { x: 0.35 * xScale, y: 0.37 * yScale, z: 0.39 * zScale }, 5, 8, '#ef9f78', { x: tilt * 0.7 },
  ));
  const earCoil = motion.coil * 0.38 + Math.max(0, -tilt) * 0.2;
  for (const side of [-1, 1]) {
    const earCenter = { x: game.player.x + side * 0.21, y: base + 1.72 * yScale, z: game.player.z - 0.34 + earCoil * 0.16 };
    faces.push(...buildEllipsoidFaces(earCenter, { x: 0.12, y: 0.46 * (1 - motion.coil * 0.16), z: 0.105 }, 4, 7, '#eca07b', { x: -earCoil, z: side * -0.13 }));
    faces.push(...buildEllipsoidFaces(
      { x: earCenter.x, y: earCenter.y, z: earCenter.z + 0.085 },
      { x: 0.055, y: 0.31 * (1 - motion.coil * 0.16), z: 0.035 }, 3, 6, '#75405a', { x: -earCoil, z: side * -0.13 },
    ));
    const legY = base + 0.28 + motion.legTuck * 0.16;
    faces.push(...buildEllipsoidFaces(
      { x: game.player.x + side * 0.31, y: legY, z: game.player.z + 0.19 },
      { x: 0.22, y: 0.18, z: 0.32 }, 4, 7, '#bd6659', { x: -motion.legTuck * 0.9 },
    ));
    faces.push(...buildEllipsoidFaces(
      { x: game.player.x + side * 0.31, y: legY - 0.12, z: game.player.z - 0.08 + motion.legTuck * 0.18 },
      { x: 0.09, y: 0.075, z: 0.28 }, 3, 6, '#2c2030', { x: -0.22 - motion.legTuck * 0.8 },
    ));
  }
  const backPatch = { x: game.player.x, y: base + 0.8 * yScale, z: game.player.z + 0.47 * zScale };
  faces.push(...buildEllipsoidFaces(backPatch, { x: 0.22, y: 0.3, z: 0.045 }, 3, 6, '#f0a47d', { x: tilt }));
}

function drawJerboaTail(nowMs: number): void {
  const motion = currentMotion(nowMs);
  const base = game.player.y - PLAYER_RADIUS + motion.bodyLift;
  const sway = Math.sin(nowMs * 0.004) * 0.14 + motion.coil * 0.28;
  const points: Vec3[] = [
    { x: 0, y: base + 0.54, z: game.player.z + 0.35 },
    { x: sway * 0.45, y: base + 0.46, z: game.player.z + 0.95 },
    { x: sway + 0.2, y: base + 0.72, z: game.player.z + 1.48 },
    { x: sway * 0.55, y: base + 1.0, z: game.player.z + 1.92 },
  ];
  const projected = points.map((point) => projectPoint(point, camera, cssWidth, cssHeight)).filter(isProjected);
  if (projected.length < 2) return;
  const width = clamp(projected.reduce((sum, point) => sum + point.scale, 0) / projected.length * 0.09, 3, 12);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#5e3946';
  context.lineWidth = width + 3;
  pathProjected(projected);
  context.stroke();
  context.strokeStyle = '#d97963';
  context.lineWidth = width;
  pathProjected(projected);
  context.stroke();
  context.restore();
}

function drawFaces(faces: MeshFace[]): void {
  const sorted = sortFacesBackToFront(faces, camera);
  context.save();
  context.lineJoin = 'round';
  for (const face of sorted) {
    const projected = face.points.map((point) => projectPoint(point, camera, cssWidth, cssHeight));
    if (projected.some((point) => !point)) continue;
    const screen = projected.filter(isProjected);
    if (screen.length < 3 || Math.abs(screenArea(screen)) < 0.18) continue;
    const normal = faceNormal(face.points);
    const intensity = 0.54 + Math.abs(dot(normal, LIGHT_DIRECTION)) * 0.48;
    context.fillStyle = shadeColor(face.color, intensity);
    context.strokeStyle = '#271b2c55';
    context.lineWidth = 0.75;
    pathProjected(screen);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawSpeedLines(nowMs: number): void {
  if (game.phase !== 'jumping') return;
  context.save();
  context.strokeStyle = '#ffd89abc';
  context.lineCap = 'round';
  for (let index = 0; index < 6; index += 1) {
    const x = ((index % 3) - 1) * 0.46;
    const y = game.player.y + 0.2 + Math.floor(index / 3) * 0.52;
    const wave = Math.sin(nowMs * 0.02 + index) * 0.12;
    const start = projectPoint({ x: x + wave, y, z: game.player.z + 0.45 }, camera, cssWidth, cssHeight);
    const end = projectPoint({ x: x + wave, y, z: game.player.z + 2.2 + index * 0.12 }, camera, cssWidth, cssHeight);
    if (!start || !end) continue;
    context.globalAlpha = 0.36 + (index % 3) * 0.14;
    context.lineWidth = clamp(start.scale * 0.018, 1.2, 4);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  context.restore();
}

function spawnDust(count: number, force: number): void {
  particleSequence += 1;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + particleSequence * 0.71;
    const variation = 0.72 + ((index * 37 + particleSequence * 13) % 29) / 70;
    const speed = (0.8 + variation * 1.4) * force;
    const life = 0.38 + variation * 0.36;
    particles.push({
      x: game.player.x + Math.cos(angle) * 0.16,
      y: 0.1,
      z: game.player.z + Math.sin(angle) * 0.16,
      vx: Math.cos(angle) * speed,
      vy: (0.8 + variation * 1.2) * force,
      vz: Math.sin(angle) * speed - game.player.vz * 0.035,
      life,
      maxLife: life,
    });
  }
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

function updateParticles(dt: number): void {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;
    particle.vy -= 4.2 * dt;
    particle.vx *= Math.max(0, 1 - dt * 2.2);
    particle.vz *= Math.max(0, 1 - dt * 2.2);
  }
}

function drawDust(): void {
  const ordered = particles
    .map((particle) => ({ particle, point: projectPoint(particle, camera, cssWidth, cssHeight) }))
    .filter((entry): entry is { particle: Particle; point: NonNullable<ReturnType<typeof projectPoint>> } => Boolean(entry.point))
    .sort((left, right) => right.point.depth - left.point.depth);
  context.save();
  for (const { particle, point } of ordered) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    context.globalAlpha = alpha * 0.78;
    context.fillStyle = '#efb17d';
    context.beginPath();
    context.arc(point.x, point.y, clamp(point.scale * 0.055, 1.2, 5.5), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawHUD(nowMs: number): void {
  const text = copy[locale];
  const uiScale = clamp(Math.min(cssWidth / 960, cssHeight / 540), 0.72, 1.25);
  drawMetric(28, 25, text.score, String(game.score).padStart(2, '0'), 'left', uiScale);
  drawMetric(cssWidth - 28, 25, text.best, String(game.bestScore).padStart(2, '0'), 'right', uiScale);
  if (awardLife > 0) {
    const progress = 1 - awardLife / 0.9;
    context.save();
    context.globalAlpha = clamp(awardLife * 2.2, 0, 1);
    context.fillStyle = '#ffe8a8';
    context.textAlign = 'center';
    context.font = `900 ${Math.round(20 * uiScale)}px system-ui`;
    context.fillText(awardText, cssWidth / 2, 112 - progress * 28);
    context.restore();
  }
  if (game.phase === 'game-over') {
    drawPanel(text.ended, text.again, uiScale);
    return;
  }
  if (cssWidth < 560) {
    drawPanel(text.keyboard, text.controls, uiScale);
    return;
  }
  const prompt = game.phase === 'charging' ? text.release : text.ready;
  context.save();
  context.textAlign = 'center';
  context.fillStyle = '#fff2d9';
  context.shadowColor = '#120e1acc';
  context.shadowBlur = 8;
  context.font = `850 ${Math.round(16 * uiScale)}px system-ui`;
  context.fillText(prompt, cssWidth / 2, cssHeight - 42);
  context.shadowBlur = 0;
  if (game.phase === 'charging' && game.chargeStartedAtMs !== undefined) {
    const ratio = chargeRatio(nowMs - game.chargeStartedAtMs);
    const width = Math.min(280, cssWidth * 0.38);
    context.fillStyle = '#ffffff24';
    roundRect(context, cssWidth / 2 - width / 2, cssHeight - 27, width, 9, 5);
    context.fill();
    const gradient = context.createLinearGradient(cssWidth / 2 - width / 2, 0, cssWidth / 2 + width / 2, 0);
    gradient.addColorStop(0, '#f4b468');
    gradient.addColorStop(0.72, '#ff8b6d');
    gradient.addColorStop(1, '#fff0a8');
    context.fillStyle = gradient;
    roundRect(context, cssWidth / 2 - width / 2, cssHeight - 27, Math.max(9, width * ratio), 9, 5);
    context.fill();
  }
  context.restore();
}

function drawMetric(x: number, y: number, label: string, value: string, align: CanvasTextAlign, scale: number): void {
  context.save();
  context.textAlign = align;
  context.fillStyle = '#f8e5ca';
  context.shadowColor = '#100c18aa';
  context.shadowBlur = 7;
  context.font = `800 ${Math.round(12 * scale)}px system-ui`;
  context.fillText(label, x, y + 12 * scale);
  context.font = `900 ${Math.round(34 * scale)}px system-ui`;
  context.fillText(value, x, y + 48 * scale);
  context.restore();
}

function drawPanel(title: string, message: string, scale: number): void {
  const width = Math.min(cssWidth - 36, 400 * scale);
  const height = 148 * scale;
  const x = cssWidth / 2 - width / 2;
  const y = cssHeight / 2 - height / 2;
  context.save();
  const gradient = context.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, '#11192bea');
  gradient.addColorStop(1, '#271c2dea');
  context.fillStyle = gradient;
  roundRect(context, x, y, width, height, 24 * scale);
  context.fill();
  context.strokeStyle = '#efc58f70';
  context.lineWidth = 1.5;
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = '#fff0d2';
  context.font = `900 ${Math.round(28 * scale)}px system-ui`;
  context.fillText(title, cssWidth / 2, cssHeight / 2 - 10 * scale);
  context.fillStyle = '#d9bda5';
  context.font = `750 ${Math.round(15 * scale)}px system-ui`;
  context.fillText(message, cssWidth / 2, cssHeight / 2 + 30 * scale);
  context.restore();
}

function drawWorldRing(center: Vec3, radiusX: number, radiusZ: number, color: string, alpha: number, width: number): void {
  const projected = ellipseWorldPoints(center, radiusX, radiusZ, 34)
    .map((point) => projectPoint(point, camera, cssWidth, cssHeight))
    .filter(isProjected);
  if (projected.length < 3) return;
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.shadowColor = color;
  context.shadowBlur = 7;
  pathProjected(projected, true);
  context.stroke();
  context.restore();
}

function drawWorldLine(from: Vec3, to: Vec3): void {
  const start = projectPoint(from, camera, cssWidth, cssHeight);
  const end = projectPoint(to, camera, cssWidth, cssHeight);
  if (!start || !end) return;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function ellipseWorldPoints(center: Vec3, radiusX: number, radiusZ: number, segments: number): Vec3[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return {
      x: center.x + Math.sin(angle) * radiusX,
      y: center.y,
      z: center.z + Math.cos(angle) * radiusZ,
    };
  });
}

function pathProjected(points: readonly { x: number; y: number }[], close = true): void {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  if (close) context.closePath();
}

function screenArea(points: readonly { x: number; y: number }[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    area += points[index].x * points[next].y - points[next].x * points[index].y;
  }
  return area * 0.5;
}

function currentMotion(nowMs: number): ReturnType<typeof sceneMotion> {
  const charge = game.phase === 'charging' && game.chargeStartedAtMs !== undefined
    ? chargeRatio(nowMs - game.chargeStartedAtMs)
    : 0;
  return sceneMotion(game.phase, charge, game.player.vy, game.landedElapsed, nowMs);
}

function currentPlatformForPlayer(): Platform | undefined {
  return game.platforms.find((platform) => platform.id === game.currentPlatformID);
}

function nextTargetPlatform(): Platform | undefined {
  return game.platforms
    .filter((platform) => platform.id !== game.currentPlatformID && platform.z < game.player.z)
    .sort((left, right) => right.z - left.z)[0];
}

function roundRect(
  drawingContext: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  drawingContext.beginPath();
  drawingContext.moveTo(x + r, y);
  drawingContext.arcTo(x + width, y, x + width, y + height, r);
  drawingContext.arcTo(x + width, y + height, x, y + height, r);
  drawingContext.arcTo(x, y + height, x, y, r);
  drawingContext.arcTo(x, y, x + width, y, r);
  drawingContext.closePath();
}

function syncAccessibility(force: boolean): void {
  if (!ready || disposed || accessibilityInFlight) return;
  const text = copy[locale];
  const signature = `${locale}:${game.phase}:${game.score}:${game.bestScore}:${surfaceVisible}`;
  if (!force && signature === accessibilitySignature) return;
  accessibilitySignature = signature;
  const stateLabel = game.phase === 'game-over' ? text.ended : game.phase === 'charging' ? text.release : text.ready;
  const description = `${stateLabel}. ${text.score} ${game.score}. ${text.best} ${game.bestScore}. ${text.controls}.`;
  const update = bridge.updateCanvasAccessibility('playfield', { label: text.label, description })
    .catch(() => undefined)
    .finally(() => {
      if (accessibilityInFlight === update) accessibilityInFlight = undefined;
    });
  accessibilityInFlight = update;
}

function isProjected<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

void (camera satisfies Camera3D);
