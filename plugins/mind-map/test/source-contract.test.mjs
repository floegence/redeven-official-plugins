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

  it('uses compact spatial-editor chrome without horizontal toolbar scrolling', async () => {
    const [app, css] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
    ]);
    assert.match(app, /className="canvas-command-deck"/u);
    assert.match(app, /className="command-cluster/u);
    assert.match(app, /'save-pill is-error'.*'save-pill is-saving'.*'save-pill'/u);
    assert.match(app, /className="shortcut-pill"/u);
    assert.match(app, /className=\{`tool-icon icon-\$\{icon\}`\}/u);
    assert.doesNotMatch(css, /container: mind-map \/ inline-size/u);
    assert.doesNotMatch(css, /@container mind-map/u);
    assert.match(css, /@media \(max-width: 760px\)/u);
    assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/u);
    assert.doesNotMatch(app, /className="toolbar"/u);
  });

  it('renders a contemporary canvas hierarchy with branch color and selection depth', async () => {
    const app = await readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8');
    assert.match(app, /function drawCanvasAtmosphere/u);
    assert.match(app, /createLinearGradient/u);
    assert.match(app, /function drawSelectionHalo/u);
    assert.match(app, /function branchColor/u);
  });

  it('builds release WASM in the pinned Linux environment', async () => {
    const [packageJSON, releaseBuild, wasmBuild] = await Promise.all([
      readFile(path.join(root, 'package.json'), 'utf8'),
      readFile(path.join(root, 'scripts', 'build-release.mjs'), 'utf8'),
      readFile(path.join(root, 'scripts', 'build-release-wasm.sh'), 'utf8'),
    ]);
    assert.match(packageJSON, /build-release\.mjs/u);
    assert.match(releaseBuild, /MIND_MAP_RELEASE_WASM/u);
    assert.match(wasmBuild, /--platform linux\/amd64/u);
    assert.match(wasmBuild, /rust:1\.88-bookworm@sha256:/u);
    assert.match(wasmBuild, /cargo build --locked --release/u);
  });
});
