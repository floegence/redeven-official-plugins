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

type Locale = 'en-US' | 'zh-CN';
type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number };

const copy = {
  'en-US': {
    title: 'Pocket Pounce', score: 'SCORE', best: 'BEST', ready: 'HOLD SPACE TO CHARGE',
    release: 'RELEASE TO JUMP', ended: 'TUMBLE IN THE DUNES', again: 'HOLD SPACE TO HOP AGAIN',
    keyboard: 'Keyboard required', exact: 'CENTER +2', controls: 'Hold Space · Release to jump',
    label: 'Pocket Pounce game canvas',
  },
  'zh-CN': {
    title: '跃跃小跳鼠', score: '得分', best: '最佳', ready: '按住空格蓄力',
    release: '松开空格跳跃', ended: '掉进沙丘啦', again: '按住空格重新开始',
    keyboard: '需要键盘操作', exact: '中心落点 +2', controls: '按住空格蓄力 · 松开跳跃',
    label: '跃跃小跳鼠游戏画布',
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
let lastFrameAt = 0;
let accumulator = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let surfaceVisible = true;
let disposed = false;
let ready = false;
let reducedMotion = false;
let lastPhase: GamePhase = game.phase;
let lastScore = game.score;
let awardText = '';
let awardLife = 0;
let accessibilitySignature = '';
let accessibilityInFlight: Promise<void> | undefined;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function updateReducedMotion(): void {
  reducedMotion = reducedMotionQuery.matches;
}

updateReducedMotion();
reducedMotionQuery.addEventListener('change', updateReducedMotion);

bridge.onCanvasInput('playfield', handleInput);
bridge.onLifecycle((event) => {
  if (event.type === 'hidden') {
    surfaceVisible = false;
    cancelCharge(game);
    stopFrameLoop();
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
    reducedMotionQuery.removeEventListener('change', updateReducedMotion);
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
        aria-label="Pocket Pounce game canvas"
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
  pixelRatio = clamp(nextPixelRatio || 1, 0.5, 4);
  if (canvas) {
    canvas.width = Math.max(1, Math.ceil(cssWidth * pixelRatio));
    canvas.height = Math.max(1, Math.ceil(cssHeight * pixelRatio));
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
    updateParticles(1 / 120);
    accumulator -= 1 / 120;
  }
  observeGameTransitions();
  cameraX += (game.cameraTargetX - cameraX) * Math.min(1, elapsed * (reducedMotion ? 30 : 7));
  awardLife = Math.max(0, awardLife - elapsed);
  draw(now);
  syncAccessibility(false);
  scheduleFrame();
}

function observeGameTransitions(): void {
  if (lastPhase === 'jumping' && game.phase === 'landed') {
    if (!reducedMotion) createLandingDust();
    const gained = game.score - lastScore;
    awardText = gained === 2 ? copy[locale].exact : '+1';
    awardLife = 0.9;
  }
  lastPhase = game.phase;
  lastScore = game.score;
}

function createLandingDust(): void {
  for (let index = 0; index < 12; index += 1) {
    const direction = index % 2 === 0 ? -1 : 1;
    particles.push({
      x: game.player.x + direction * (6 + index * 0.8),
      y: game.player.y + game.player.radius - 3,
      vx: direction * (28 + index * 5),
      vy: -35 - (index % 4) * 9,
      life: 0.55 + (index % 3) * 0.08,
      size: 3 + index % 4,
    });
  }
}

function updateParticles(dt: number): void {
  for (const particle of particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 90 * dt;
    particle.life -= dt;
  }
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    if (particles[index].life <= 0) particles.splice(index, 1);
  }
}

function draw(nowMs: number): void {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const backdrop = context.createLinearGradient(0, 0, 0, cssHeight);
  backdrop.addColorStop(0, '#0d1930');
  backdrop.addColorStop(0.58, '#26304a');
  backdrop.addColorStop(1, '#6f4f42');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(renderScale, renderScale);
  drawSky(nowMs / 1000);
  drawDunes();
  context.save();
  context.translate(-cameraX, 0);
  for (const platform of game.platforms) drawPlatform(platform);
  for (const particle of particles) drawParticle(particle);
  drawJerboa(nowMs);
  context.restore();
  drawHUD(nowMs);
  context.restore();
}

function drawSky(time: number): void {
  const sky = context.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
  sky.addColorStop(0, '#101a35');
  sky.addColorStop(0.56, '#343550');
  sky.addColorStop(1, '#9a6550');
  context.fillStyle = sky;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.fillStyle = '#ffe6b0';
  context.shadowColor = '#ffd894';
  context.shadowBlur = 32;
  context.beginPath();
  context.arc(786, 100, 42, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = '#f5d7a9';
  for (let index = 0; index < 42; index += 1) {
    const x = (index * 83 + 31) % WORLD_WIDTH;
    const y = 24 + (index * 47) % 215;
    const pulse = reducedMotion ? 1 : 0.72 + Math.sin(time * 1.2 + index) * 0.22;
    context.globalAlpha = pulse;
    context.fillRect(x, y, index % 9 === 0 ? 2 : 1, index % 9 === 0 ? 2 : 1);
  }
  context.globalAlpha = 1;
}

function drawDunes(): void {
  context.fillStyle = '#6e4d46';
  context.beginPath();
  context.moveTo(0, 365);
  context.bezierCurveTo(180, 305, 270, 380, 450, 335);
  context.bezierCurveTo(650, 285, 740, 370, 960, 310);
  context.lineTo(960, 540);
  context.lineTo(0, 540);
  context.closePath();
  context.fill();
  context.fillStyle = '#bd8061';
  context.beginPath();
  context.moveTo(0, 430);
  context.bezierCurveTo(190, 360, 340, 470, 530, 398);
  context.bezierCurveTo(710, 330, 805, 455, 960, 390);
  context.lineTo(960, 540);
  context.lineTo(0, 540);
  context.closePath();
  context.fill();
}

function drawPlatform(platform: Platform): void {
  const x = platform.x;
  const y = platform.top;
  const gradient = context.createLinearGradient(x, y, x, y + 68);
  gradient.addColorStop(0, '#ddb17d');
  gradient.addColorStop(0.18, '#a96f58');
  gradient.addColorStop(1, '#513942');
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(x + platform.width / 2, y + 5, platform.width / 2, 18, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(x + 4, y + 5);
  context.quadraticCurveTo(x + 10, y + 58, x + 34, y + 68);
  context.lineTo(x + platform.width - 32, y + 68);
  context.quadraticCurveTo(x + platform.width - 7, y + 54, x + platform.width - 4, y + 5);
  context.closePath();
  context.fill();
  context.strokeStyle = '#f7cc92';
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(x + platform.width / 2, y + 2, platform.width / 2 - 3, 14, 0, Math.PI, Math.PI * 2);
  context.stroke();
}

function drawJerboa(nowMs: number): void {
  const charging = game.phase === 'charging' && game.chargeStartedAtMs !== undefined
    ? chargeRatio(nowMs - game.chargeStartedAtMs)
    : 0;
  const airborne = game.phase === 'jumping';
  const squash = charging * 0.24;
  const angle = airborne ? clamp(game.player.vy / 1_600, -0.26, 0.24) : 0;
  context.save();
  context.translate(game.player.x, game.player.y + charging * 6);
  context.rotate(angle);
  context.scale(1 + squash * 0.3, 1 - squash);
  context.lineCap = 'round';
  context.strokeStyle = '#4c2f35';
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(-15, 4);
  context.bezierCurveTo(-44, 3, -48, -28 - charging * 18, -17, -31 - charging * 8);
  context.stroke();
  context.fillStyle = '#d98765';
  context.beginPath();
  context.ellipse(-1, 3, 21, 18, -0.1, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#eda27a';
  context.beginPath();
  context.arc(13, -10, 16, 0, Math.PI * 2);
  context.fill();
  for (const direction of [-1, 1]) {
    context.fillStyle = '#e99a75';
    context.beginPath();
    context.ellipse(7 + direction * 8, -29, 6, 14, direction * 0.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#75434a';
    context.beginPath();
    context.ellipse(7 + direction * 8, -30, 2.5, 8, direction * 0.2, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = '#221d29';
  context.beginPath();
  context.arc(18, -13, 2.5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f7d7b5';
  context.beginPath();
  context.ellipse(25, -6, 6, 4, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#5a343a';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(-7, 16);
  context.lineTo(-15, 23 + charging * 5);
  context.moveTo(7, 16);
  context.lineTo(16, 22 + charging * 5);
  context.stroke();
  context.restore();
}

function drawParticle(particle: Particle): void {
  context.globalAlpha = clamp(particle.life * 1.8, 0, 1);
  context.fillStyle = '#efd09f';
  context.beginPath();
  context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
}

function drawHUD(nowMs: number): void {
  const text = copy[locale];
  context.fillStyle = '#f8e5ca';
  context.font = '800 13px system-ui';
  context.textAlign = 'left';
  context.fillText(text.score, 34, 38);
  context.font = '900 34px system-ui';
  context.fillText(String(game.score).padStart(2, '0'), 34, 72);
  context.textAlign = 'right';
  context.font = '800 13px system-ui';
  context.fillText(text.best, WORLD_WIDTH - 34, 38);
  context.font = '900 34px system-ui';
  context.fillText(String(game.bestScore).padStart(2, '0'), WORLD_WIDTH - 34, 72);

  if (awardLife > 0) {
    context.globalAlpha = clamp(awardLife * 2, 0, 1);
    context.fillStyle = '#ffd58d';
    context.textAlign = 'center';
    context.font = '900 18px system-ui';
    context.fillText(awardText, WORLD_WIDTH / 2, 105 - (0.9 - awardLife) * 18);
    context.globalAlpha = 1;
  }

  if (game.phase === 'game-over') {
    drawPanel(text.ended, text.again);
    return;
  }
  const narrow = cssWidth < 560;
  if (narrow) {
    drawPanel(text.keyboard, text.controls);
    return;
  }
  const prompt = game.phase === 'charging' ? text.release : text.ready;
  context.textAlign = 'center';
  context.fillStyle = '#fff1d7';
  context.font = '850 16px system-ui';
  context.fillText(prompt, WORLD_WIDTH / 2, 488);
  if (game.phase === 'charging' && game.chargeStartedAtMs !== undefined) {
    const ratio = chargeRatio(nowMs - game.chargeStartedAtMs);
    context.fillStyle = '#ffffff24';
    roundRect(WORLD_WIDTH / 2 - 126, 501, 252, 8, 4);
    context.fill();
    const chargeGradient = context.createLinearGradient(WORLD_WIDTH / 2 - 126, 0, WORLD_WIDTH / 2 + 126, 0);
    chargeGradient.addColorStop(0, '#f4b468');
    chargeGradient.addColorStop(1, '#ff776c');
    context.fillStyle = chargeGradient;
    roundRect(WORLD_WIDTH / 2 - 126, 501, Math.max(8, 252 * ratio), 8, 4);
    context.fill();
  }
}

function drawPanel(title: string, message: string): void {
  context.fillStyle = '#101522d9';
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
