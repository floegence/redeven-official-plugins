import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Pocket Pounce source contract', () => {
  it('is a permissionless sandboxed Canvas game with one authoritative model', async () => {
    const [manifest, app, model] = await Promise.all([
      readFile(path.join(root, 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(path.join(root, 'ui/src/app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui/src/game-model.ts'), 'utf8'),
    ]);
    assert.equal(manifest.schema_version, 'redevplugin.manifest.v9');
    assert.equal(manifest.plugin.plugin_id, 'com.redeven.official.pocket-pounce');
    assert.equal(manifest.plugin.version, '1.0.12');
    assert.deepEqual(manifest.permissions, []);
    assert.deepEqual(manifest.workers, []);
    assert.deepEqual(manifest.methods, []);
    assert.equal(manifest.storage, undefined);
    assert.equal(manifest.network_access, undefined);
    assert.equal(manifest.surfaces[0].surface_id, 'pocket-pounce.game');
    assert.match(app, /bridge\.openCanvas\(['"]playfield['"]\)/u);
    assert.match(app, /bridge\.onCanvasInput\(['"]playfield['"]/u);
    assert.match(app, /bridge\.onLifecycle/u);
    assert.match(app, /bridge\.onContext/u);
    assert.match(app, /event\.type === 'hidden'[\s\S]*cancelCharge\(game\)[\s\S]*stopFrameLoop\(\)/u);
    assert.match(app, /event\.type === 'visible'[\s\S]*lastFrameAt = performance\.now\(\)[\s\S]*accumulator = 0/u);
    assert.match(app, /event\.type === 'dispose'[\s\S]*stopFrameLoop\(\)[\s\S]*canvas\.width = 1[\s\S]*canvas\.height = 1/u);
    assert.match(app, /clamp\(\(now - lastFrameAt\) \/ 1000, 0, 0\.05\)/u);
    assert.match(app, /canvasBackingSize\(cssWidth, cssHeight, nextPixelRatio\)/u);
    assert.match(model, /export function jumpDistanceForCharge/u);
    assert.doesNotMatch(app, /\b(?:window|document|navigator)\b/u);
    assert.doesNotMatch(`${app}\n${model}`, /\bfetch\s*\(|WebSocket|localStorage|sessionStorage|indexedDB|https?:\/\//u);
  });

  it('ships only original local artwork and keyboard-first copy', async () => {
    const [manifest, notices, readme, svg] = await Promise.all([
      readFile(path.join(root, 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
      readFile(path.join(root, 'README.md'), 'utf8'),
      readFile(path.join(root, 'assets/source/pocket-pounce.svg'), 'utf8'),
    ]);
    assert.equal(manifest.presentation.icon.path, 'ui/assets/pocket-pounce.png');
    assert.equal(manifest.surfaces[0].icon, 'ui/assets/pocket-pounce.png');
    assert.match(notices, /does not contain third-party visual, audio, or font assets/iu);
    assert.match(readme, /hold Space/iu);
    assert.match(svg, /Pocket Pounce original icon/u);
    assert.doesNotMatch(`${notices}\n${readme}\n${svg}`, /WeChat|微信/u);
  });
});
