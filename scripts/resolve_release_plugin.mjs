import { loadAllPluginSources, repoRootFrom, resolvePluginForReleaseTag } from './lib/officialPlugins.mjs';

const tag = String(process.argv[2] ?? '').trim();
if (!/^[A-Za-z0-9][A-Za-z0-9._+@-]{0,254}$/u.test(tag)) {
  console.error('usage: node scripts/resolve_release_plugin.mjs <release-tag>');
  process.exit(2);
}

const source = resolvePluginForReleaseTag(await loadAllPluginSources(repoRootFrom(import.meta.url)), tag);
process.stdout.write(`${source.name}\n`);
