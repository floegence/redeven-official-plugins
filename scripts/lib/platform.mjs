import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJSON, repoRootFrom } from './officialPlugins.mjs';

const execute = promisify(execFile);
const root = repoRootFrom(import.meta.url);
let checked;
export async function platformCLI(args) {
  const version = (await readJSON(new URL('../../package.json', import.meta.url))).redevplugin_version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('released platform version is required');
  const explicit = process.env.REDEVPLUGIN_CLI;
  const command = explicit || 'go';
  const prefix = explicit ? [] : ['run', `github.com/floegence/redevplugin/v3/cmd/redevplugin@v${version}`];
  const run = async (arguments_) => {
    const result = await execute(command, [...prefix, ...arguments_], { cwd: root, timeout: 600000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GOWORK: 'off', GOTOOLCHAIN: 'go1.27.3+auto', GOPROXY: 'https://proxy.golang.org,direct', GOPRIVATE: '', GONOSUMDB: '' } });
    return JSON.parse(result.stdout);
  };
  checked ??= run(['version']).then((value) => {
    if (value.platform_version !== version || value.plugin_api !== 1) throw new Error('CLI does not match the released platform baseline');
  });
  await checked;
  return run(args);
}
