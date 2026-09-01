import {
  PluginBridgeClient,
  type PluginCanvasInputEvent,
} from '@floegence/redevplugin-ui/plugin';
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  beginCharge,
  cancelCharge,
  chargeRatio,
  createGame,
  releaseJump,
  stepGame,
  type GamePhase,
  type Platform,
} from './game-model.js';
import { canvasBackingSize } from './canvas-backing.js';
import { projectPoint, sceneMotion, type Point3D, type SceneMotion } from './scene-3d.js';

type Locale = 'en-US' | 'zh-CN';
type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
};

const copy = {
  'en-US': {
    score: 'SCORE', best: 'BEST', ready: 'HOLD SPACE TO CHARGE',
    release: 'RELEASE TO POUNCE', ended: 'TUMBLE IN THE DUNES', again: 'HOLD SPACE TO HOP AGAIN',
    keyboard: 'Keyboard required', exact: 'CENTER +2', controls: 'Hold Space · Release to jump',
    label: 'Pocket Pounce three-dimensional game canvas',
  },
  'zh-CN': {
    score: '得分', best: '最佳', ready: '按住空格蓄力',
    release: '松开空格跃出', ended: '掉进沙丘啦', again: '按住空格重新开始',
    keyboard: '需要键盘操作', exact: '中心落点 +2', controls: '按住空格蓄力 · 松开跳跃',
    label: '跃跃小跳鼠三维游戏画布',
  },
} as const;

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const game = createGame(Date.now());
const particles: Particle[] = [];
let locale: Locale = 'en-US';
let canvas: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
let cssWidth = WORLD_WIDTH;
let cssHeight = WORLD_HEIGHT;
let pixelRatio = 1;
let renderScale = 1;
let offsetX = 0;
let offsetY = 0;
let cameraX = 0;
let cameraZ = 0;
let renderCameraX = 0;
let renderCameraZ = 0;
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
let ringX = game.player.x;
let ringZ = game.player.z;
let particleSequence = 0;
let accessibilitySignature = '';
let accessibilityInFlight: Promise<void> | undefined;

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
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        tabindex={0}
        autofocus
        aria-label="Pocket Pounce three-dimensional game canvas"
      />
    </main>,
  );
  const surface = await bridge.openCanvas('playfield');
  canvas = surface.canvas;
  configureCanvas(surface.cssWidth, surface.cssHeight, surface.devicePixelRatio);
  const nextContext = canvas.getContext('2d', { alpha: false });
  if (!nextContext) throw new Error('2D Canvas is unavailable');
  context = nextContext;
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
          <p key="pocket-pounce-error-copy">The game could not start. Reopen the plugin to try again.</p>
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
  pixelRatio = backing.pixelRatio;
  if (canvas) {
    canvas.width = backing.width;
    canvas.height = backing.height;
  }
  renderScale = Math.min(cssWidth / WORLD_WIDTH, cssHeight / WORLD_HEIGHT);
  offsetX = (cssWidth - WORLD_WIDTH * renderScale) / 2;
  offsetY = (cssHeight - WORLD_HEIGHT * renderScale) / 2;
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
  while (accumulator >= 1 / 120) {
    stepGame(game, 1 / 120);
    accumulator -= 1 / 120;
  }
  observeGameTransitions();
  updateParticles(elapsed);
  const targetCameraX = game.phase === 'jumping'
    ? Math.max(game.cameraTargetX, game.player.x - 325)
    : game.cameraTargetX;
  const targetCameraZ = game.phase === 'jumping' ? game.player.z * 0.32 : game.cameraTargetZ;
  const cameraEase = 1 - Math.exp(-elapsed * 5.2);
  cameraX += (targetCameraX - cameraX) * cameraEase;
  cameraZ += (targetCameraZ - cameraZ) * cameraEase;
  awardLife = Math.max(0, awardLife - elapsed);
  launchRingLife = Math.max(0, launchRingLife - elapsed);
  landingRingLife = Math.max(0, landingRingLife - elapsed);
  draw(now);
  syncAccessibility(false);
  scheduleFrame();
}

function observeGameTransitions(): void {
  if (lastPhase === 'charging' && game.phase === 'jumping') {
    ringX = game.player.x;
    ringZ = game.player.z;
    launchRingLife = 0.34;
    spawnDust(9, 0.72);
  }
  if (lastPhase === 'jumping' && game.phase === 'landed') {
    const gained = game.score - lastScore;
    awardText = gained === 2 ? copy[locale].exact : '+1';
    awardLife = 0.9;
    ringX = game.player.x;
    ringZ = game.player.z;
    landingRingLife = 0.5;
    spawnDust(20, 1);
  }
  lastPhase = game.phase;
  lastScore = game.score;
}

function spawnDust(count: number, force: number): void {
  particleSequence += 1;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + particleSequence * 0.73;
    const variation = 0.72 + ((index * 37 + particleSequence * 13) % 29) / 70;
    const speed = (45 + variation * 58) * force;
    const life = 0.36 + variation * 0.34;
    particles.push({
      x: game.player.x + Math.cos(angle) * 8,
      y: game.player.y + game.player.radius - 3,
      z: game.player.z + Math.sin(angle) * 7,
      vx: Math.cos(angle) * speed - game.player.vx * 0.04,
      vy: -(32 + variation * 55) * force,
      vz: Math.sin(angle) * speed,
      size: 4 + variation * 5,
      life,
      maxLife: life,
      color: index % 3 === 0 ? '#ffd29a' : '#d7906f',
    });
  }
  if (particles.length > 48) particles.splice(0, particles.length - 48);
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
    particle.vy += 260 * dt;
    particle.vx *= Math.max(0, 1 - dt * 2.2);
    particle.vz *= Math.max(0, 1 - dt * 2.2);
  }
}

function draw(nowMs: number): void {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const backdrop = context.createLinearGradient(0, 0, 0, cssHeight);
  backdrop.addColorStop(0, '#071226');
  backdrop.addColorStop(0.58, '#242b48');
  backdrop.addColorStop(1, '#775143');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(renderScale, renderScale);
  const charge = game.phase === 'charging' && game.chargeStartedAtMs !== undefined
    ? chargeRatio(nowMs - game.chargeStartedAtMs)
    : 0;
  const motion = sceneMotion(game.phase, charge, game.player.vy, game.landedElapsed, nowMs);
  const shake = motion.cameraShake;
  renderCameraX = cameraX + Math.sin(nowMs * 0.09) * shake;
  renderCameraZ = cameraZ + Math.cos(nowMs * 0.075) * shake * 0.7;
  drawSky();
  drawDunes();
  drawGroundPlane();
  drawScene(nowMs, motion);
  drawHUD(nowMs);
  context.restore();
}

function drawSky(): void {
  const sky = context.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
  sky.addColorStop(0, '#08142b');
  sky.addColorStop(0.54, '#30334f');
  sky.addColorStop(1, '#a26952');
  context.fillStyle = sky;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  const moonGlow = context.createRadialGradient(786, 94, 8, 786, 94, 76);
  moonGlow.addColorStop(0, '#fff5cfdd');
  moonGlow.addColorStop(0.46, '#ffd99548');
  moonGlow.addColorStop(1, '#ffd99500');
  context.fillStyle = moonGlow;
  context.beginPath();
  context.arc(786, 94, 76, 0, Math.PI * 2);
  context.fill();
  const moon = context.createRadialGradient(770, 78, 3, 786, 94, 43);
  moon.addColorStop(0, '#fffdf1');
  moon.addColorStop(0.7, '#ffe8af');
  moon.addColorStop(1, '#e9bd79');
  context.fillStyle = moon;
  context.beginPath();
  context.arc(786, 94, 42, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f8deb5';
  for (let index = 0; index < 48; index += 1) {
    const parallax = renderCameraX * (index % 3 + 1) * 0.006;
    const x = positiveModulo(index * 83 + 31 - parallax, WORLD_WIDTH);
    const y = 22 + (index * 47) % 205;
    const size = index % 11 === 0 ? 2 : 1;
    context.globalAlpha = index % 5 === 0 ? 0.95 : 0.62;
    context.fillRect(x, y, size, size);
  }
  context.globalAlpha = 1;
}

function drawDunes(): void {
  const farShift = positiveModulo(renderCameraX * 0.045, 420);
  context.fillStyle = '#55404a';
  context.beginPath();
  context.moveTo(-farShift - 200, 350);
  context.bezierCurveTo(20 - farShift, 290, 220 - farShift, 390, 450 - farShift, 324);
  context.bezierCurveTo(670 - farShift, 274, 790 - farShift, 372, 1_180 - farShift, 294);
  context.lineTo(1_180, 540);
  context.lineTo(-200, 540);
  context.closePath();
  context.fill();
  const nearShift = positiveModulo(renderCameraX * 0.085, 520);
  const near = context.createLinearGradient(0, 330, 0, 540);
  near.addColorStop(0, '#b57658');
  near.addColorStop(1, '#6b463f');
  context.fillStyle = near;
  context.beginPath();
  context.moveTo(-nearShift - 220, 438);
  context.bezierCurveTo(20 - nearShift, 350, 250 - nearShift, 470, 510 - nearShift, 386);
  context.bezierCurveTo(750 - nearShift, 322, 960 - nearShift, 444, 1_300 - nearShift, 362);
  context.lineTo(1_300, 540);
  context.lineTo(-220, 540);
  context.closePath();
  context.fill();
}

function drawGroundPlane(): void {
  const corners: Point3D[] = [
    { x: renderCameraX - 240, y: 490, z: -300 },
    { x: renderCameraX + 1_360, y: 490, z: -300 },
    { x: renderCameraX + 1_360, y: 490, z: 360 },
    { x: renderCameraX - 240, y: 490, z: 360 },
  ];
  const ground = context.createLinearGradient(0, 330, 0, 540);
  ground.addColorStop(0, '#9d624d88');
  ground.addColorStop(1, '#4b343bcc');
  drawProjectedPolygon(corners, ground);
  context.lineWidth = 1;
  for (let lane = -240; lane <= 320; lane += 80) {
    strokeProjectedLine(
      { x: renderCameraX - 220, y: 488, z: lane },
      { x: renderCameraX + 1_340, y: 488, z: lane },
      '#f5bd8130',
    );
  }
  const firstLine = Math.floor((renderCameraX - 160) / 150) * 150;
  for (let x = firstLine; x <= renderCameraX + 1_300; x += 150) {
    strokeProjectedLine({ x, y: 488, z: -260 }, { x, y: 488, z: 330 }, '#4a324750');
  }
}

function drawScene(nowMs: number, motion: SceneMotion): void {
  const orderedPlatforms = [...game.platforms].sort((left, right) => right.z - left.z);
  for (const platform of orderedPlatforms) drawPlatform(platform, motion);
  drawTargetMarker(nowMs);
  if (launchRingLife > 0) drawWorldRing(ringX, 413, ringZ, (0.34 - launchRingLife) * 130 + 18, launchRingLife / 0.34, '#ffc57e');
  if (landingRingLife > 0) drawWorldRing(ringX, 412, ringZ, (0.5 - landingRingLife) * 190 + 24, landingRingLife / 0.5, '#fff0bd');
  drawShadow(motion);
  drawParticles();
  drawJerboa(nowMs, motion);
}

function drawPlatform(platform: Platform, motion: SceneMotion): void {
  const impact = platform.id === game.currentPlatformID && game.phase === 'landed' ? motion.impact : 0;
  const top = platform.top + impact * 7;
  const bottom = top + 60 - impact * 4;
  const nearZ = platform.z - platform.depth / 2;
  const farZ = platform.z + platform.depth / 2;
  const topFace: Point3D[] = [
    { x: platform.x + platform.width * 0.08, y: top, z: nearZ },
    { x: platform.x + platform.width * 0.92, y: top, z: nearZ },
    { x: platform.x + platform.width, y: top, z: platform.z },
    { x: platform.x + platform.width * 0.92, y: top, z: farZ },
    { x: platform.x + platform.width * 0.08, y: top, z: farZ },
    { x: platform.x, y: top, z: platform.z },
  ];
  const frontFace: Point3D[] = [topFace[0], topFace[1],
    { x: platform.x + platform.width * 0.78, y: bottom, z: nearZ },
    { x: platform.x + platform.width * 0.22, y: bottom, z: nearZ }];
  const rightFace: Point3D[] = [topFace[1], topFace[2],
    { x: platform.x + platform.width * 0.86, y: bottom - 8, z: platform.z },
    { x: platform.x + platform.width * 0.78, y: bottom, z: nearZ }];
  const frontGradient = context.createLinearGradient(0, 330, 0, 455);
  frontGradient.addColorStop(0, '#955b50');
  frontGradient.addColorStop(1, '#34283a');
  drawProjectedPolygon(frontFace, frontGradient);
  drawProjectedPolygon(rightFace, '#493044');
  const topGradient = context.createLinearGradient(0, 310, 0, 390);
  topGradient.addColorStop(0, '#f0c68e');
  topGradient.addColorStop(0.52, '#c88b68');
  topGradient.addColorStop(1, '#8b574f');
  drawProjectedPolygon(topFace, topGradient);
  context.strokeStyle = '#ffe0a8aa';
  context.lineWidth = 1.7;
  pathProjected(topFace);
  context.stroke();
  const accentA = projectPoint({ x: platform.x + platform.width * 0.22, y: top - 1, z: platform.z - 8 }, renderCameraX, renderCameraZ);
  const accentB = projectPoint({ x: platform.x + platform.width * 0.52, y: top - 1, z: platform.z + 14 }, renderCameraX, renderCameraZ);
  context.strokeStyle = '#6f474875';
  context.lineWidth = Math.max(1, accentA.scale * 2);
  context.beginPath();
  context.moveTo(accentA.x, accentA.y);
  context.lineTo(accentB.x, accentB.y);
  context.stroke();
}

function drawTargetMarker(nowMs: number): void {
  const target = game.platforms
    .filter((platform) => platform.id !== game.currentPlatformID && platform.x > game.player.x)
    .sort((left, right) => left.x - right.x)[0];
  if (!target) return;
  const pulse = 0.72 + Math.sin(nowMs * 0.006) * 0.12;
  drawWorldRing(target.x + target.width / 2, target.top - 2, target.z, target.width * 0.15, pulse, '#ffe3a4');
  drawWorldRing(target.x + target.width / 2, target.top - 3, target.z, target.width * 0.06, pulse * 0.8, '#fff7d7');
}

function drawShadow(motion: SceneMotion): void {
  const platform = game.platforms.find((candidate) => candidate.id === game.currentPlatformID);
  const groundY = platform?.top ?? 414;
  const height = Math.max(0, groundY - (game.player.y + game.player.radius));
  const point = projectPoint({ x: game.player.x, y: groundY - 1, z: game.player.z }, renderCameraX, renderCameraZ);
  const shrink = clamp(1 - height / 260, 0.3, 1);
  context.save();
  context.translate(point.x, point.y);
  context.scale(point.scale * shrink * (1 + motion.impact * 0.2), point.scale * shrink * 0.34);
  const shadow = context.createRadialGradient(0, 0, 3, 0, 0, 34);
  shadow.addColorStop(0, '#170f20a8');
  shadow.addColorStop(1, '#170f2000');
  context.fillStyle = shadow;
  context.beginPath();
  context.arc(0, 0, 34, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawParticles(): void {
  const ordered = [...particles].sort((left, right) => right.z - left.z);
  for (const particle of ordered) {
    const point = projectPoint(particle, renderCameraX, renderCameraZ);
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    context.globalAlpha = alpha * 0.82;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(point.x, point.y, particle.size * point.scale * (1.2 - alpha * 0.3), 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function drawJerboa(nowMs: number, motion: SceneMotion): void {
  const point = projectPoint(game.player, renderCameraX, renderCameraZ);
  context.save();
  context.translate(point.x, point.y + motion.bodyLift * point.scale);
  context.rotate(motion.tilt);
  context.scale(point.scale * motion.scaleX, point.scale * motion.scaleY * motion.stretchY);
  if (game.phase === 'jumping') drawSpeedLines();
  context.lineCap = 'round';
  const tailLift = 28 + motion.coil * 20;
  context.strokeStyle = '#432b3a';
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(-15, 7);
  context.bezierCurveTo(-45, 8, -54, -tailLift, -21 + motion.coil * 6, -35 - motion.coil * 6);
  context.stroke();
  context.strokeStyle = '#f0a17d';
  context.lineWidth = 2.2;
  context.beginPath();
  context.moveTo(-17, 5);
  context.bezierCurveTo(-42, 5, -49, -tailLift + 2, -22 + motion.coil * 6, -36 - motion.coil * 6);
  context.stroke();

  drawLeg(-7, 16, -17, 25 - motion.legTuck * 14);
  drawLeg(8, 16, 18, 24 - motion.legTuck * 16);

  for (const direction of [-1, 1]) {
    const earGradient = context.createLinearGradient(0, -47, 0, -15);
    earGradient.addColorStop(0, '#ffbd92');
    earGradient.addColorStop(1, '#b96961');
    context.fillStyle = earGradient;
    context.beginPath();
    context.ellipse(8 + direction * 8, -29, 6.5, 15.5, direction * 0.19, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#6f3c50';
    context.beginPath();
    context.ellipse(8 + direction * 8, -30, 2.4, 9, direction * 0.19, 0, Math.PI * 2);
    context.fill();
  }

  const body = context.createRadialGradient(-8, -8, 3, -1, 4, 29);
  body.addColorStop(0, '#ffc09a');
  body.addColorStop(0.45, '#db866c');
  body.addColorStop(1, '#7d4850');
  context.fillStyle = body;
  context.beginPath();
  context.ellipse(-1, 4, 22, 19, -0.08, 0, Math.PI * 2);
  context.fill();

  const head = context.createRadialGradient(7, -18, 2, 13, -10, 22);
  head.addColorStop(0, '#ffc39b');
  head.addColorStop(0.55, '#ec9b78');
  head.addColorStop(1, '#99585a');
  context.fillStyle = head;
  context.beginPath();
  context.arc(13, -10, 17, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#ffd1aa88';
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(11, -12, 13.5, Math.PI * 1.08, Math.PI * 1.82);
  context.stroke();

  context.fillStyle = '#1d1826';
  context.beginPath();
  context.arc(18, -14, 3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(19, -15, 0.9, 0, Math.PI * 2);
  context.fill();
  const muzzle = context.createRadialGradient(22, -8, 1, 25, -6, 8);
  muzzle.addColorStop(0, '#fff0d2');
  muzzle.addColorStop(1, '#d59b7d');
  context.fillStyle = muzzle;
  context.beginPath();
  context.ellipse(25, -6, 7, 4.7, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#3b2430';
  context.beginPath();
  context.arc(31, -7, 1.8, 0, Math.PI * 2);
  context.fill();

  if (game.phase === 'charging') {
    context.globalAlpha = 0.28 + motion.coil * 0.34;
    context.strokeStyle = '#ffd58d';
    context.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      context.beginPath();
      context.arc(0, 2, 31 + index * 7 + Math.sin(nowMs * 0.01) * 2, Math.PI * 1.08, Math.PI * 1.86);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  context.restore();
}

function drawLeg(fromX: number, fromY: number, toX: number, toY: number): void {
  context.strokeStyle = '#5a3442';
  context.lineWidth = 5.5;
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.quadraticCurveTo((fromX + toX) / 2, toY - 3, toX, toY);
  context.stroke();
  context.strokeStyle = '#eda17e';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(toX - 2, toY);
  context.lineTo(toX + 5, toY + 1);
  context.stroke();
}

function drawSpeedLines(): void {
  const speed = clamp(Math.abs(game.player.vx) / 480, 0.45, 1);
  context.strokeStyle = '#ffd99b66';
  context.lineWidth = 2;
  for (let index = 0; index < 4; index += 1) {
    const y = -14 + index * 10;
    context.beginPath();
    context.moveTo(-30 - index * 7, y);
    context.lineTo(-58 - index * 11 * speed, y + 4);
    context.stroke();
  }
}

function drawWorldRing(x: number, y: number, z: number, radius: number, alpha: number, color: string): void {
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha, 0, 1) * 0.78;
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    const point = projectPoint({ x: x + Math.cos(angle) * radius, y, z: z + Math.sin(angle) * radius }, renderCameraX, renderCameraZ);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
  context.globalAlpha = 1;
}

function drawHUD(nowMs: number): void {
  const text = copy[locale];
  drawMetric(30, 26, text.score, String(game.score).padStart(2, '0'), 'left');
  drawMetric(WORLD_WIDTH - 30, 26, text.best, String(game.bestScore).padStart(2, '0'), 'right');
  if (awardLife > 0) {
    const progress = 1 - awardLife / 0.9;
    context.globalAlpha = clamp(awardLife * 2.2, 0, 1);
    context.fillStyle = '#ffe8a8';
    context.textAlign = 'center';
    context.font = '900 19px system-ui';
    context.fillText(awardText, WORLD_WIDTH / 2, 108 - progress * 24);
    context.globalAlpha = 1;
  }
  if (game.phase === 'game-over') {
    drawPanel(text.ended, text.again);
    return;
  }
  if (cssWidth < 560) {
    drawPanel(text.keyboard, text.controls);
    return;
  }
  const prompt = game.phase === 'charging' ? text.release : text.ready;
  context.textAlign = 'center';
  context.fillStyle = '#fff2d9';
  context.font = '850 16px system-ui';
  context.fillText(prompt, WORLD_WIDTH / 2, 486);
  if (game.phase === 'charging' && game.chargeStartedAtMs !== undefined) {
    const ratio = chargeRatio(nowMs - game.chargeStartedAtMs);
    context.fillStyle = '#ffffff24';
    roundRect(WORLD_WIDTH / 2 - 126, 499, 252, 9, 5);
    context.fill();
    const chargeGradient = context.createLinearGradient(WORLD_WIDTH / 2 - 126, 0, WORLD_WIDTH / 2 + 126, 0);
    chargeGradient.addColorStop(0, '#f4b468');
    chargeGradient.addColorStop(0.72, '#ff8b6d');
    chargeGradient.addColorStop(1, '#fff0a8');
    context.fillStyle = chargeGradient;
    roundRect(WORLD_WIDTH / 2 - 126, 499, Math.max(9, 252 * ratio), 9, 5);
    context.fill();
  }
}

function drawMetric(x: number, y: number, label: string, value: string, align: CanvasTextAlign): void {
  context.textAlign = align;
  context.fillStyle = '#f8e5ca';
  context.font = '800 12px system-ui';
  context.fillText(label, x, y + 12);
  context.font = '900 33px system-ui';
  context.fillText(value, x, y + 47);
}

function drawPanel(title: string, message: string): void {
  const panel = context.createLinearGradient(0, WORLD_HEIGHT / 2 - 76, 0, WORLD_HEIGHT / 2 + 76);
  panel.addColorStop(0, '#11192be8');
  panel.addColorStop(1, '#271c2de8');
  context.fillStyle = panel;
  roundRect(WORLD_WIDTH / 2 - 196, WORLD_HEIGHT / 2 - 74, 392, 148, 24);
  context.fill();
  context.strokeStyle = '#efc58f70';
  context.lineWidth = 1.5;
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = '#fff0d2';
  context.font = '900 28px system-ui';
  context.fillText(title, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10);
  context.fillStyle = '#d9bda5';
  context.font = '750 15px system-ui';
  context.fillText(message, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 30);
}

function drawProjectedPolygon(points: Point3D[], fill: string | CanvasGradient): void {
  context.fillStyle = fill;
  pathProjected(points);
  context.fill();
}

function pathProjected(points: Point3D[]): void {
  context.beginPath();
  points.forEach((worldPoint, index) => {
    const point = projectPoint(worldPoint, renderCameraX, renderCameraZ);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
}

function strokeProjectedLine(start: Point3D, end: Point3D, color: string): void {
  const projectedStart = projectPoint(start, renderCameraX, renderCameraZ);
  const projectedEnd = projectPoint(end, renderCameraX, renderCameraZ);
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(projectedStart.x, projectedStart.y);
  context.lineTo(projectedEnd.x, projectedEnd.y);
  context.stroke();
}

function roundRect(x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
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

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
