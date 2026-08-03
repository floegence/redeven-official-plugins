import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  loadPluginSource,
  repoRootFrom,
  sha256Hex,
  stableJSONString,
  validatePluginSource,
} from './lib/officialPlugins.mjs';

const redevpluginVersion = 'v0.7.1';
const repoRoot = repoRootFrom(import.meta.url);
const pluginName = String(process.argv[2] ?? '').trim();

if (!pluginName) {
  console.error('usage: node scripts/build_official_plugin.mjs <plugin-name>');
  process.exit(2);
}

const source = await loadPluginSource(repoRoot, pluginName);
const errors = await validatePluginSource(source);
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const version = source.manifest.plugin.version;
const outDir = path.join(repoRoot, 'dist', pluginName, version);
const unsignedPackage = path.join(outDir, `${pluginName}-${version}.unsigned.redevplugin`);
await mkdir(outDir, { recursive: true });

await runReDevPlugin(['package', path.join(source.pluginRoot, 'dist'), unsignedPackage]);
await runReDevPlugin(['validate', unsignedPackage]);

const data = await readFile(unsignedPackage);
const metadata = {
  schema_version: 'redeven.official_plugin_artifact.v1',
  plugin_id: source.manifest.plugin.plugin_id,
  version,
  package_file: path.relative(repoRoot, unsignedPackage),
  package_sha256: `sha256:${sha256Hex(data)}`,
  signed: false,
};
await writeFile(path.join(outDir, `${pluginName}-${version}.metadata.json`), stableJSONString(metadata));
console.log(stableJSONString(metadata).trimEnd());

function runReDevPlugin(args) {
  const explicit = String(process.env.REDEVPLUGIN_CLI ?? '').trim();
  const command = explicit || 'go';
  const finalArgs = explicit
    ? args
    : ['run', `github.com/floegence/redevplugin/cmd/redevplugin@${redevpluginVersion}`, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(command, finalArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        GOWORK: 'off',
        GOTOOLCHAIN: 'go1.26.5+auto',
        GOPROXY: 'https://proxy.golang.org,direct',
        GOPRIVATE: '',
        GONOSUMDB: '',
      },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${finalArgs.join(' ')} exited with ${code}`));
    });
  });
}
