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
    assert.match(app, /onKeyboardInput\(handleKeyboardInput\)/u);
    assert.match(app, /setKeyboardBindings/u);
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

  it('uses one accessible button to toggle between bilateral and right-only layouts', async () => {
    const [app, css, build] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'scripts', 'build.mjs'), 'utf8'),
    ]);
    assert.match(app, /bridge\.onAction\('toggle-layout'/u);
    assert.match(app, /currentDocument\(\)\.layout === 'bilateral' \? 'right' : 'bilateral'/u);
    assert.match(app, /toolButton\(\s*'toggle-layout'/u);
    assert.equal([...app.matchAll(/toolButton\(\s*'toggle-layout'/gu)].length, 1);
    assert.match(app, /document\.layout === 'bilateral' \? 'switch-right' : 'switch-bilateral'/u);
    assert.match(app, /document\.layout === 'bilateral' \? t\.switchToRight : t\.switchToBilateral/u);
    assert.match(app, /t\.switchToRight : t\.switchToBilateral,\s*\)/u);
    assert.doesNotMatch(app, /toolButton\('(layout-bilateral|layout-right|switch-right|switch-bilateral)'/u);
    assert.match(css, /icons\/switch-right\.png/u);
    assert.match(css, /icons\/switch-bilateral\.png/u);
    assert.doesNotMatch(css, /icons\/layout-(bilateral|right)\.png/u);
    assert.match(build, /'switch-bilateral\.png'.*'switch-right\.png'/su);
  });

  it('renders a contemporary canvas hierarchy with independent colors and line-style deep topics', async () => {
    const [app, layout] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'layout.ts'), 'utf8'),
    ]);
    assert.match(app, /function drawCanvasAtmosphere/u);
    assert.match(app, /createLinearGradient/u);
    assert.match(app, /function drawSelectionHalo/u);
    assert.match(app, /function drawDraggedNode/u);
    assert.match(app, /const draggingID = activeDraggedNodeID\(\)/u);
    assert.match(app, /context\.globalAlpha = opacity/u);
    assert.match(app, /function drawTopicNode/u);
    assert.match(app, /topicUnderline\(box\)/u);
    assert.match(app, /edgeAnchor\(from, edge\.side, 'source'\)/u);
    assert.match(app, /edgeAnchor\(to, edge\.side, 'target'\)/u);
    assert.doesNotMatch(app, /box\.depth === 2\) context\.fillStyle/u);
    assert.doesNotMatch(app, /const railWidth = box\.depth === 1 \? 3 : 2/u);
    assert.doesNotMatch(app, /function branchColor/u);
    assert.match(app, /nodeColor\(node\.color\)/u);
    assert.match(layout, /measureNodeText/u);
    assert.doesNotMatch(app, /function fittedTitle/u);
    assert.match(app, /for \(const \[lineIndex, line\] of box\.text\.lines\.entries\(\)\)/u);
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

  it('uses commercial map editing interactions without a node rename dialog', async () => {
    const [app, editorUI, styles, build] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'editor-ui.ts'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'scripts', 'build.mjs'), 'utf8'),
    ]);
    assert.doesNotMatch(app, /kind: 'rename-node'/u);
    assert.doesNotMatch(app, /case 'rename-node'/u);
    assert.match(app, /className=\{`\$\{placement\.className\}/u);
    assert.match(app, /data-redevplugin-action="edit-node-title"/u);
    assert.match(app, /data-redevplugin-action="commit-node-title"/u);
    assert.match(app, /data-redevplugin-escape-action="cancel-node-title"/u);
    assert.match(app, /<textarea/u);
    assert.match(app, /<textarea\s+key=\{NODE_TITLE_INPUT_KEY\}/u);
    assert.match(styles, /var\(--node-editor-zoom\)/u);
    assert.match(build, /node-editor-z-/u);
    assert.match(app, /event\.isComposing/u);
    assert.match(app, /event\.type === 'wheel'/u);
    assert.match(app, /zoomViewportAtPoint/u);
    assert.match(app, /if \(nodeTitleEditor\?\.isComposing\) return;\s*commitNodeTitleEdit\(\);/su);
    assert.doesNotMatch(app, /keepsEditor/u);
    assert.match(editorUI, /normalizeWheelDelta/u);
  });

  it('offers per-node text alignment with matching canvas and editor rendering', async () => {
    const [app, styles, model] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'workspace-model.ts'), 'utf8'),
    ]);
    assert.match(app, /data-redevplugin-action="set-node-alignment"/u);
    assert.match(app, /textLineAnchor\(box, node\.alignment\)/u);
    assert.match(app, /alignment-\$\{node\.alignment\}/u);
    assert.match(styles, /\.alignment-button\[aria-pressed="true"\]/u);
    assert.match(styles, /\.node-title-editor\.alignment-left textarea/u);
    assert.match(styles, /\.node-title-editor\.alignment-right textarea/u);
    assert.match(model, /alignment: \$\{node\.alignment\}/u);
  });

  it('exports image and DSL files with clear icons and immediate localized tooltips', async () => {
    const [app, exports, styles, build] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'export.ts'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'scripts', 'build.mjs'), 'utf8'),
    ]);

    assert.match(app, /bridge\.exportFile\(/u);
    assert.match(exports, /'png'.*'jpeg'.*'webp'.*'svg'.*'dsl'/su);
    assert.match(app, /toolButton\('import-document', 'upload'/u);
    assert.match(app, /toolButton\('export-document', 'download'/u);
    assert.doesNotMatch(app, /data-tooltip/u);
    assert.match(app, /className="tool-button has-tooltip tooltip-bottom"/u);
    assert.match(app, /colorLabel\(color\)/u);
    assert.doesNotMatch(app, /aria-label=\{color\}/u);
    assert.match(styles, /button\.has-tooltip::after/u);
    assert.match(styles, /content:\s*attr\(aria-label\)/u);
    assert.match(styles, /transition-delay:\s*0s/u);
    assert.match(app, /targetCanvas\.convertToBlob\(/u);
    assert.doesNotMatch(app, /document\.createElement\('canvas'\)/u);
    assert.match(build, /'upload\.png'/u);
    assert.match(build, /'download\.png'/u);
  });

  it('updates transferred canvas accessibility outside localized UI patches', async () => {
    const app = await readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8');
    const canvas = app.match(/<canvas\s+key="map-canvas"[\s\S]*?><\/canvas>/u)?.[0];

    assert.ok(canvas, 'map canvas must remain present');
    assert.match(canvas, /aria-label="Mind Map"/u);
    assert.doesNotMatch(canvas, /aria-label=\{t\.app\}/u);
    assert.match(app, /if \(localeChanged && canvas\) void updateCanvasAccessibility\(\)/u);
    assert.match(app, /function updateCanvasAccessibility\(\): Promise<void>/u);
    assert.match(app, /bridge\.updateCanvasAccessibility\(CANVAS_ID, \{/u);
  });

  it('gives the subtree expander priority over node drag selection', async () => {
    const app = await readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8');
    const expanderHit = app.indexOf('const expander = hitExpander');
    const nodeHit = app.indexOf('const hit = hitNode', expanderHit);
    assert.ok(expanderHit >= 0);
    assert.ok(nodeHit > expanderHit);
    assert.match(app, /toggleSubtree\(expander\.id\)/u);
    assert.equal((app.match(/toggleCollapsed\(/gu) ?? []).length, 1);
  });

  it('stores one canonical DSL payload and retains contiguous v1 and v2 migrations', async () => {
    const [app, worker, manifest] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'worker', 'src', 'lib.rs'), 'utf8'),
      readFile(path.join(root, 'manifest.json'), 'utf8').then(JSON.parse),
    ]);
    assert.match(app, /workspace_dsl: serializeWorkspaceDSL\(snapshot\)/u);
    assert.match(app, /parseWorkspaceDSL\(response\.workspace_dsl\)/u);
    assert.match(worker, /workspace-v3\.json/u);
    assert.match(worker, /workspace-v2\.json/u);
    assert.match(worker, /workspace-v1\.json/u);
    assert.match(worker, /migrate_v1_to_v2/u);
    assert.match(worker, /migrate_v2_to_v3/u);
    assert.equal(manifest.storage.stores[0].schema_version, 1);
    assert.match(worker, /const STATE_SCHEMA_VERSION: u32 = 3/u);
    assert.deepEqual(manifest.methods[0].response_schema.required, ['revision', 'saved_at', 'workspace_dsl']);
    assert.deepEqual(manifest.methods[1].request_schema.required, ['expected_revision', 'workspace_dsl']);
  });

  it('fails closed until the saved workspace is confirmed after a runtime restart', async () => {
    const [app, startup, styles, entry] = await Promise.all([
      readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(root, 'ui', 'src', 'startup-load.ts'), 'utf8'),
      readFile(path.join(root, 'ui', 'styles.css'), 'utf8'),
      readFile(path.join(root, 'ui', 'index.html'), 'utf8'),
    ]);
    assert.match(app, /if \(!await loadWorkspaceAtStartup\(\)\) return/u);
    assert.match(app, /if \(loadState !== 'ready'\) return/u);
    assert.match(app, /loadState !== 'ready' \? startupOverlay\(\) : null/u);
    assert.doesNotMatch(app, /initialized = true/u);
    assert.match(startup, /STARTUP_LOAD_RETRY_DELAYS_MS = \[500, 1_000, 2_000, 4_000, 8_000\]/u);
    assert.match(app, /startup-indicator-bar/u);
    assert.match(styles, /startup-indicator span \{/u);
    assert.doesNotMatch(app, /loadingBody|startup-card/u);
    assert.match(app, /role=\{failed \? 'alert' : 'status'\}/u);
    assert.match(app, /failed \? <p key="startup-message"/u);
    assert.match(app, /data-redevplugin-action="retry-workspace-load"/u);
    assert.match(styles, /prefers-reduced-motion: reduce/u);
    assert.match(entry, /class="startup-indicator"/u);
    assert.doesNotMatch(`${entry}\n${styles}`, /loading-mark|mind-map-loading|startup-card/u);
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
