import { readdir, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadPluginSource, repoRootFrom } from './lib/officialPlugins.mjs';

const redevpluginVersion = 'v0.7.1';
const repoRoot = repoRootFrom(import.meta.url);
const action = String(process.argv[2] ?? '').trim();
const pluginName = String(process.argv[3] ?? '').trim();

if (!['prepare', 'apply', 'finalize', 'verify'].includes(action) || !pluginName) {
  console.error('usage: node scripts/release_official_plugin.mjs <prepare|apply|finalize|verify> <plugin-name> [response-file-or-directory]');
  process.exit(2);
}

const source = await loadPluginSource(repoRoot, pluginName);
const version = source.manifest.plugin.version;
const releaseRoot = path.join(repoRoot, 'releases', pluginName, version);
const configFile = path.join(releaseRoot, 'publisher-config.json');
const workRoot = path.join(repoRoot, 'dist', 'release', pluginName, version);
const workspace = path.join(workRoot, 'workspace');
const output = path.join(workRoot, 'output');
const unsignedPackage = path.join(repoRoot, 'dist', pluginName, version, `${pluginName}-${version}.unsigned.redevplugin`);

if (action === 'prepare') {
  await run('npm', ['run', `build:${pluginName}`]);
  await runNodeScript('scripts/build_official_plugin.mjs', pluginName);
  await runReDevPlugin(['release', 'prepare', configFile, unsignedPackage, workspace]);
} else if (action === 'apply') {
  const responsePath = String(process.argv[4] ?? '').trim();
  if (!responsePath) {
    console.error('apply requires a response file or directory');
    process.exit(2);
  }
  await applyAvailableResponses(responsePath);
} else if (action === 'finalize') {
  await runReDevPlugin(['release', 'finalize', workspace, output]);
  await runReDevPlugin(['release', 'verify', output]);
} else {
  await runReDevPlugin(['release', 'verify', output]);
}

async function applyAvailableResponses(responsePath) {
  const files = await listResponseFiles(path.resolve(responsePath));
  const responses = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.schema_version !== 'redevplugin.external_signer_response.v1' || typeof parsed.request_id !== 'string') {
      throw new Error(`${file} is not an external signer response`);
    }
    responses.push({ file, requestID: parsed.request_id });
  }

  const applied = new Set();
  for (;;) {
    const requestIDs = new Set(await currentRequestIDs());
    let progress = false;
    for (const response of responses) {
      if (applied.has(response.file) || !requestIDs.has(response.requestID)) continue;
      await runReDevPlugin(['release', 'apply-signature', workspace, response.file]);
      applied.add(response.file);
      progress = true;
      break;
    }
    if (!progress) break;
  }

  const remaining = await currentRequestIDs();
  console.log(JSON.stringify({ applied: applied.size, pending_requests: remaining.length, requests_directory: path.join(workspace, 'requests') }, null, 2));
}

async function currentRequestIDs() {
  const requestsDirectory = path.join(workspace, 'requests');
  let entries;
  try {
    entries = await readdir(requestsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const requestIDs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const parsed = JSON.parse(await readFile(path.join(requestsDirectory, entry.name), 'utf8'));
    if (typeof parsed.request_id === 'string') requestIDs.push(parsed.request_id);
  }
  return requestIDs.sort();
}

async function listResponseFiles(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  if (!info.isDirectory()) throw new Error(`${target} is not a file or directory`);
  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(target, entry.name))
    .sort();
}

function runNodeScript(script, ...args) {
  return run(process.execPath, [path.join(repoRoot, script), ...args]);
}

function runReDevPlugin(args) {
  const explicit = String(process.env.REDEVPLUGIN_CLI ?? '').trim();
  return explicit
    ? run(explicit, args)
    : run('go', ['run', `github.com/floegence/redevplugin/cmd/redevplugin@${redevpluginVersion}`, ...args], {
      GOWORK: 'off',
      GOTOOLCHAIN: 'go1.26.5+auto',
      GOPROXY: 'https://proxy.golang.org,direct',
      GOPRIVATE: '',
      GONOSUMDB: '',
    });
}

function run(command, args, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnvironment },
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
