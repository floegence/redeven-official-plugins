import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const releaseWorker = String(process.env.MIND_MAP_RELEASE_WASM ?? '').trim();
const iconAssets = [
  'add.png', 'minus.png', 'undo.png', 'redo.png', 'child.png', 'sibling.png',
  'rename.png', 'collapse.png', 'delete.png', 'bilateral.png', 'right.png',
  'center.png', 'duplicate.png', 'network.png', 'upload.png', 'download.png',
  'text-left.png', 'text-center.png', 'text-right.png',
];

await rm(resolve(root, 'dist'), { recursive: true, force: true });
run(npm, ['run', 'build:ui']);
let workerSource;
if (releaseWorker) {
  workerSource = resolve(releaseWorker);
  await access(workerSource);
  const bytes = await readFile(workerSource);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
    throw new Error('MIND_MAP_RELEASE_WASM is not a WebAssembly module');
  }
} else {
  run(cargo, ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', 'worker/Cargo.toml']);
  workerSource = resolve(root, 'worker/target/wasm32-unknown-unknown/release/redeven_official_mind_map_worker.wasm');
}

await mkdir(resolve(root, 'dist/ui/assets'), { recursive: true });
await mkdir(resolve(root, 'dist/ui/assets/icons'), { recursive: true });
await mkdir(resolve(root, 'dist/workers'), { recursive: true });
await mkdir(resolve(root, 'dist/licenses'), { recursive: true });
const styles = await readFile(resolve(root, 'ui/styles.css'), 'utf8');
await Promise.all([
  copyFile(resolve(root, 'manifest.json'), resolve(root, 'dist/manifest.json')),
  copyFile(resolve(root, 'ui/index.html'), resolve(root, 'dist/ui/index.html')),
  writeFile(resolve(root, 'dist/ui/assets/styles.css'), `${styles}\n${nodeEditorPlacementCSS()}`, 'utf8'),
  copyFile(resolve(root, 'assets/mind-map.png'), resolve(root, 'dist/ui/assets/mind-map.png')),
  copyFile(resolve(root, 'THIRD_PARTY_NOTICES.txt'), resolve(root, 'dist/licenses/THIRD_PARTY_NOTICES.txt')),
  copyFile(resolve(root, 'node_modules/lucide-static/LICENSE'), resolve(root, 'dist/licenses/LUCIDE-LICENSE.txt')),
  copyFile(workerSource, resolve(root, 'dist/workers/mind-map.wasm')),
  ...iconAssets.map((asset) => copyFile(
    resolve(root, 'assets/icons', asset),
    resolve(root, 'dist/ui/assets/icons', asset),
  )),
]);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function nodeEditorPlacementCSS() {
  const rules = [];
  for (let value = 0; value <= 8192; value += 2) {
    rules.push(`.node-editor-x-${value}{left:${value}px}`);
    rules.push(`.node-editor-y-${value}{top:${value}px}`);
  }
  for (let value = 0; value <= 4096; value += 2) {
    rules.push(`.node-editor-w-${value}{width:${value}px}`);
    rules.push(`.node-editor-h-${value}{height:${value}px}`);
  }
  for (let value = 320; value <= 2400; value += 1) {
    rules.push(`.node-editor-z-${value}{--node-editor-zoom:${value / 1000}}`);
  }
  return `${rules.join('\n')}\n`;
}
