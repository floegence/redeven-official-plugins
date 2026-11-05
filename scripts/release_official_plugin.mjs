import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadPluginSource, repoRootFrom, sha256Hex } from './lib/officialPlugins.mjs';
import { platformCLI } from './lib/platform.mjs';

const execute = promisify(execFile);
const root = repoRootFrom(import.meta.url);
const [action, name] = process.argv.slice(2);
if (!['build', 'verify'].includes(action) || !name) throw new Error('usage: node scripts/release_official_plugin.mjs <build|verify> <plugin-name> [artifact-directory]');
const source = await loadPluginSource(root, name);
const version = source.manifest.plugin.version;
const output = process.argv[4] ? path.resolve(process.argv[4]) : path.join(root, 'dist', name, version);
if (action === 'build') {
  for (const [command, args] of [['npm', ['--prefix', source.pluginRoot, 'run', 'build:release']], [process.execPath, ['scripts/build_official_plugin.mjs', name]]]) {
    const result = await execute(command, args, { cwd: root, timeout: 1200000, maxBuffer: 16 * 1024 * 1024 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  }
}
const metadata = JSON.parse(await readFile(path.join(output, `${name}-${version}.metadata.json`), 'utf8'));
const filename = path.join(output, `${name}-${version}.redevplugin`);
const bytes = await readFile(filename);
const inspection = await platformCLI(['release', 'inspect', filename]);
if (metadata.package_file !== path.basename(filename) || metadata.version !== version || metadata.plugin_id !== source.manifest.plugin.plugin_id ||
    metadata.archive_sha256 !== `sha256:${sha256Hex(bytes)}` || metadata.size !== bytes.length ||
    inspection.version !== version || inspection.plugin_id !== metadata.plugin_id ||
    ['package_sha256', 'manifest_sha256', 'entries_sha256'].some((key) => metadata[key] !== inspection[key])) throw new Error('release artifact readback differs from its exact package');
console.log(JSON.stringify({ plugin_id: inspection.plugin_id, version, archive_sha256: metadata.archive_sha256, package_sha256: inspection.package_sha256 }));
