import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pluginRoot, '../..');
const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));
const releaseWorker = path.join(
  repoRoot,
  'dist',
  'release',
  'mind-map',
  manifest.plugin.version,
  'canonical-mind-map.wasm',
);

await run(path.join(pluginRoot, 'scripts', 'build-release-wasm.sh'), [releaseWorker], repoRoot);
await run('npm', ['run', 'build'], pluginRoot, { MIND_MAP_RELEASE_WASM: releaseWorker });

function run(command, args, cwd, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnvironment },
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}`)));
  });
}
