import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Mind Map source contract', () => {
  it('uses only the sandbox bridge, Canvas, and declared storage worker', async () => {
    const [app, manifest] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'manifest.json'), 'utf8').then(JSON.parse),
    ]);
    assert.match(app, /new PluginBridgeClient/u);
    assert.match(app, /openCanvas\(CANVAS_ID\)/u);
    assert.match(app, /onCanvasInput\(CANVAS_ID/u);
    assert.match(app, /onLifecycle/u);
    assert.match(app, /mindmap\.workspace\.load/u);
    assert.match(app, /mindmap\.workspace\.save/u);
    assert.doesNotMatch(app, /\b(?:fetch|WebSocket|indexedDB|sessionStorage|localStorage)\b/u);
    assert.deepEqual(manifest.permissions, []);
    assert.equal(manifest.workers.length, 1);
    assert.equal(manifest.storage.stores.length, 1);
  });

  it('ships no external assets, URLs, fonts, or audio', async () => {
    const [app, css, notice] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
    ]);
    assert.doesNotMatch(`${app}\n${css}`, /https?:\/\//u);
    assert.doesNotMatch(`${app}\n${css}`, /@font-face|\.mp3|\.wav|\.ogg/iu);
    assert.match(notice, /No third-party visual, audio, or font assets/u);
  });
});
