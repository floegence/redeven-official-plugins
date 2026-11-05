import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPluginSource, repoRootFrom, sha256Hex, stableJSONString, validatePluginSource } from './lib/officialPlugins.mjs';
import { platformCLI } from './lib/platform.mjs';

const root = repoRootFrom(import.meta.url);
const name = process.argv[2];
if (!name) throw new Error('usage: node scripts/build_official_plugin.mjs <plugin-name>');
const source = await loadPluginSource(root, name);
const errors = await validatePluginSource(source);
if (errors.length) throw new Error(errors.join('\n'));
const version = source.manifest.plugin.version;
const output = path.join(root, 'dist', name, version);
const filename = `${name}-${version}.redevplugin`;
const packagePath = path.join(output, filename);
await mkdir(output, { recursive: true });
await platformCLI(['package', path.join(source.pluginRoot, 'dist'), packagePath]);
const inspection = await platformCLI(['release', 'inspect', packagePath]);
if (inspection.plugin_id !== source.manifest.plugin.plugin_id || inspection.version !== version) throw new Error('packaged identity differs from source');
const bytes = await readFile(packagePath);
const metadata = { schema_version: 'redeven.official_plugin_artifact.v1', plugin_id: inspection.plugin_id, version,
  package_file: filename, archive_sha256: `sha256:${sha256Hex(bytes)}`, size: bytes.length,
  package_sha256: inspection.package_sha256, manifest_sha256: inspection.manifest_sha256, entries_sha256: inspection.entries_sha256 };
await writeFile(path.join(output, `${name}-${version}.metadata.json`), stableJSONString(metadata));
console.log(stableJSONString(metadata).trimEnd());
