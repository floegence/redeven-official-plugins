import { loadAllPluginSources, repoRootFrom, resolvePluginForReleaseTag } from './lib/officialPlugins.mjs';

const tag = String(process.argv[2] ?? '').trim();
if (!/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(tag)) {
  console.error('usage: node scripts/resolve_release_plugin.mjs <vMAJOR.MINOR.PATCH>');
  process.exit(2);
}

const source = resolvePluginForReleaseTag(await loadAllPluginSources(repoRootFrom(import.meta.url)), tag);
process.stdout.write(`${source.name}\n`);
