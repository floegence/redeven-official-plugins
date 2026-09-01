import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadAllPluginSources, repoRootFrom } from './lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);
const action = String(process.argv[2] ?? '').trim();
const supported = new Set(['ci', 'test', 'typecheck', 'build', 'build:release', 'audit']);

if (!supported.has(action)) {
  console.error('usage: node scripts/run_official_plugins.mjs <ci|test|typecheck|build|build:release|audit>');
  process.exit(2);
}

for (const source of await loadAllPluginSources(repoRoot)) {
  const args = action === 'ci'
    ? ['--prefix', source.pluginRoot, 'ci']
    : action === 'audit'
      ? ['--prefix', source.pluginRoot, 'audit', '--audit-level=moderate']
      : ['--prefix', source.pluginRoot, 'run', action];
  await run('npm', args);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)));
  });
}
