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

  it('ships no remote assets, fonts, or audio and attributes Lucide icons', async () => {
    const [app, css, notice, packageJSON, build] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
      readFile(path.join(root, 'package.json'), 'utf8'),
      readFile(path.join(root, 'scripts', 'build.mjs'), 'utf8'),
    ]);
    assert.doesNotMatch(`${app}\n${css}`, /https?:\/\//u);
    assert.doesNotMatch(`${app}\n${css}`, /@font-face|\.mp3|\.wav|\.ogg/iu);
    assert.match(packageJSON, /"lucide-static": "1\.39\.0"/u);
    assert.match(build, /assets\/icons/u);
    assert.match(css, /icons\/add\.png/u);
    assert.match(notice, /Lucide Icons/u);
    assert.match(notice, /ISC License/u);
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
    assert.match(app, /className=\{`tool-icon lucide-icon icon-\$\{icon\}`\}/u);
    assert.doesNotMatch(css, /container: mind-map \/ inline-size/u);
    assert.doesNotMatch(css, /@container mind-map/u);
    assert.match(css, /@media \(max-width: 760px\)/u);
    assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/u);
    assert.doesNotMatch(app, /className="toolbar"/u);
  });

  it('renders a contemporary canvas hierarchy with independent colors and line-style deep topics', async () => {
    const [app, layout] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'layout.ts'), 'utf8'),
    ]);
    assert.match(app, /function drawCanvasAtmosphere/u);
    assert.match(app, /createLinearGradient/u);
    assert.match(app, /function drawSelectionHalo/u);
    assert.match(app, /function drawTopicNode/u);
    assert.match(app, /topicUnderline\(box\)/u);
    assert.match(app, /edgeAnchor\(from, edge\.side, 'source'\)/u);
    assert.match(app, /edgeAnchor\(to, edge\.side, 'target'\)/u);
    assert.doesNotMatch(app, /box\.depth === 2\) context\.fillStyle/u);
    assert.doesNotMatch(app, /const railWidth = box\.depth === 1 \? 3 : 2/u);
    assert.doesNotMatch(app, /function branchColor/u);
    assert.match(app, /nodeColor\(node\.color\)/u);
    assert.match(layout, /function nodeHeight\(depth: number\)/u);
  });

  it('supports a bounded node context menu and one resizable compact sidebar', async () => {
    const [app, css] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
    ]);
    assert.match(app, /event\.button === 2/u);
    assert.match(app, /function drawNodeContextMenu/u);
    assert.match(app, /data-redevplugin-action="narrow-sidebar"/u);
    assert.match(app, /data-redevplugin-action="widen-sidebar"/u);
    assert.doesNotMatch(app, /type="range"/u);
    assert.match(css, /\.sidebar-resizer/u);
    assert.match(css, /\.document-actions\s*\{[^}]*position:\s*absolute/su);
    assert.doesNotMatch(css, /\.document-card\.is-active::before/u);
  });

  it('fails closed until the saved workspace is confirmed after a runtime restart', async () => {
    const [app, startup] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'startup-load.ts'), 'utf8'),
    ]);
    assert.match(app, /if \(!await loadWorkspaceAtStartup\(\)\) return/u);
    assert.match(app, /if \(loadState !== 'ready'\) return/u);
    assert.match(app, /loadState !== 'ready' \? startupOverlay\(\) : null/u);
    assert.doesNotMatch(app, /initialized = true/u);
    assert.match(startup, /STARTUP_LOAD_RETRY_DELAYS_MS = \[500, 1_000, 2_000, 4_000, 8_000\]/u);
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
