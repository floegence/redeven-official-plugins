import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadPluginSource, repoRootFrom, stableJSONString } from './lib/officialPlugins.mjs';

const redevpluginVersion = 'v0.7.16';
const repoRoot = repoRootFrom(import.meta.url);
const pluginName = String(process.argv[2] ?? '').trim();

if (!/^[a-z][a-z0-9-]*$/u.test(pluginName)) {
  console.error('usage: node scripts/stage_release_capability.mjs <plugin-name>');
  process.exit(2);
}

const plugin = await loadPluginSource(repoRoot, pluginName);
const version = plugin.manifest.plugin.version;
const releaseRoot = path.join(repoRoot, 'releases', pluginName, version);
const source = JSON.parse(await readFile(path.join(releaseRoot, 'capability-source.json'), 'utf8'));
validateSource(source, pluginName, version);

const workRoot = path.join(repoRoot, 'dist', 'release', pluginName, version);
const bundleRoot = path.join(workRoot, 'capability-input');
const outputRoot = path.join(workRoot, 'output');
await mkdir(bundleRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });

for (const file of source.files) {
  const rawURL = rawGitHubURL(source.source, file.path);
  const response = await fetch(rawURL, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || response.url !== rawURL) {
    throw new Error(`capability source fetch failed for ${file.path}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyBytes(file, bytes);
  await writeExact(path.join(bundleRoot, ...file.path.split('/')), bytes);
}

const pinPath = path.join(bundleRoot, 'host-capability.pin.json');
const publicPath = path.join(bundleRoot, 'host-capability.public.json');
const committedPin = JSON.parse(await readFile(path.join(plugin.pluginRoot, 'host-capability.pin.json'), 'utf8'));
const fetchedPin = JSON.parse(await readFile(pinPath, 'utf8'));
if (stableJSONString(committedPin) !== stableJSONString(fetchedPin)) {
  throw new Error('committed plugin capability pin does not match the verified source bundle');
}
await runReDevPlugin(['host-capability', 'verify', bundleRoot, pinPath, publicPath]);

for (const file of source.files) {
  const bytes = await readFile(path.join(bundleRoot, ...file.path.split('/')));
  await writeExact(path.join(outputRoot, file.asset_name), bytes);
}
const evidence = {
  schema_version: 'redeven.official_host_capability_release_bundle.v1',
  plugin_id: plugin.manifest.plugin.plugin_id,
  plugin_version: version,
  source: source.source,
  files: source.files,
};
await writeExact(
  path.join(outputRoot, `${pluginName}-${version}.capability-bundle.json`),
  Buffer.from(stableJSONString(evidence)),
);
console.log(stableJSONString({ ok: true, files: source.files.length, output: outputRoot }).trimEnd());

function validateSource(value, expectedPlugin, expectedVersion) {
  if (value?.schema_version !== 'redeven.official_host_capability_source.v1' ||
      value.source?.repository !== 'floegence/redeven' ||
      !/^[a-f0-9]{40}$/u.test(value.source?.commit ?? '') ||
      value.source?.root !== 'spec/redevplugin/official-containers-capability-v4/bundle' ||
      !Array.isArray(value.files) || value.files.length !== 8) {
    throw new Error('host capability source manifest is invalid');
  }
  const paths = new Set();
  const assets = new Set();
  for (const file of value.files) {
    if (!validRelativePath(file?.path) || !validAssetName(file?.asset_name) ||
        !/^[a-f0-9]{64}$/u.test(file?.sha256 ?? '') || !Number.isSafeInteger(file?.size) ||
        file.size <= 0 || file.size > 1_048_576 || paths.has(file.path) || assets.has(file.asset_name) ||
        !file.asset_name.startsWith(`${expectedPlugin}-${expectedVersion}.`)) {
      throw new Error('host capability source file projection is invalid');
    }
    paths.add(file.path);
    assets.add(file.asset_name);
  }
  for (const required of ['host-capability.pin.json', 'host-capability.public.json']) {
    if (!paths.has(required)) throw new Error(`host capability source is missing ${required}`);
  }
}

function validRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !value.startsWith('/') && !value.includes('\\') && value.split('/').every((part) => /^[A-Za-z0-9._-]+$/u.test(part) && part !== '.' && part !== '..');
}

function validAssetName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u.test(value);
}

function rawGitHubURL(sourceIdentity, relativePath) {
  const segments = `${sourceIdentity.root}/${relativePath}`.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${sourceIdentity.repository}/${sourceIdentity.commit}/${segments}`;
}

function verifyBytes(file, bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== file.size || digest !== file.sha256) {
    throw new Error(`host capability source identity mismatch for ${file.path}`);
  }
}

async function writeExact(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  try {
    const current = await readFile(filename);
    if (!current.equals(bytes)) throw new Error(`existing release output conflicts at ${filename}`);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(filename, bytes, { flag: 'wx', mode: 0o644 });
}

function runReDevPlugin(args) {
  const explicit = String(process.env.REDEVPLUGIN_CLI ?? '').trim();
  return run(
    explicit || 'go',
    explicit ? args : ['run', `github.com/floegence/redevplugin/cmd/redevplugin@${redevpluginVersion}`, ...args],
  );
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
