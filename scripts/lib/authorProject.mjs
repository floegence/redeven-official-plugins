import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { platformCLI } from './platform.mjs';

// The released platform compiles identity before running any project command.
export async function buildProject(pluginRoot, release, cli = platformCLI) {
  return cli(['build', pluginRoot, ...(release ? ['--release'] : [])], {
    env: { REDEVPLUGIN_OFFICIAL_RELEASE: release ? '1' : '0' },
  });
}

// Readback compiles the current source in isolation, including actual GitHub
// resolution for a publication. It never rewrites source or build output.
export async function expectedManifest(pluginRoot, release, cli = platformCLI) {
  const output = await mkdtemp(path.join(tmpdir(), 'official-manifest-'));
  try {
    await cli(['generate', path.join(pluginRoot, 'manifest.json'), output, ...(release ? ['--release'] : [])]);
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    const mapping = JSON.parse(await readFile(path.join(output, 'source-map.json'), 'utf8'));
    return { plugin_id: manifest.plugin.plugin_id, publisher_id: manifest.publisher.publisher_id,
      version: manifest.plugin.version, manifest_sha256: `sha256:${mapping.manifest_sha256}` };
  } finally { await rm(output, { recursive: true, force: true }); }
}
