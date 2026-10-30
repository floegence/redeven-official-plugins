import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const releaseWorker = String(process.env.MIND_MAP_RELEASE_WASM ?? '').trim();
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
await mkdir(resolve(root, 'dist/workers'), { recursive: true });
await mkdir(resolve(root, 'dist/licenses'), { recursive: true });
await Promise.all([
  copyFile(resolve(root, 'manifest.json'), resolve(root, 'dist/manifest.json')),
  copyFile(resolve(root, 'assets/mind-map.png'), resolve(root, 'dist/ui/assets/mind-map.png')),
  copyFile(resolve(root, 'THIRD_PARTY_NOTICES.txt'), resolve(root, 'dist/licenses/THIRD_PARTY_NOTICES.txt')),
  copyFile(workerSource, resolve(root, 'dist/workers/mind-map.wasm')),
]);

const bundledLicenses = [
  ['Floe Webapp Core', '@floegence/floe-webapp-core/LICENSE'],
  ['ReDevPlugin UI', '@floegence/redevplugin-ui/LICENSE'],
  ['ReDevPlugin Contracts', '@floegence/redevplugin-contracts/LICENSE'],
  ['Solid', 'solid-js/LICENSE'],
  ['Noble Hashes', '@noble/hashes/LICENSE'],
  ['clsx', 'clsx/license'],
  ['tailwind-merge', 'tailwind-merge/LICENSE.md'],
];
const licenseText = await Promise.all(bundledLicenses.map(async ([name, file]) =>
  name + '\n\n' + await readFile(resolve(root, 'node_modules', file), 'utf8')));
const metadata = spawnSync(cargo, ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'worker/Cargo.toml'], { cwd: root, encoding: 'utf8' });
if (metadata.status !== 0) throw new Error(metadata.stderr || 'Cannot resolve locked Worker licenses');
const crates = JSON.parse(metadata.stdout).packages.filter(crate => crate.source)
  .sort((left, right) => left.name.localeCompare(right.name, 'en'));
for (const crate of crates) {
  const directory = dirname(crate.manifest_path);
  const licenses = (await readdir(directory)).filter(name => /^(?:LICENSE|UNLICENSE)(?:[.-]|$)/.test(name)).sort();
  if (!licenses.length) throw new Error(`Missing published license for ${crate.name}`);
  for (const license of licenses) {
    licenseText.push(`${crate.name} ${crate.version} (${license})\n\n${await readFile(resolve(directory, license), 'utf8')}`);
  }
}
await writeFile(resolve(root, 'dist/licenses/BUNDLED-LICENSES.txt'), licenseText.join('\n\n'));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
