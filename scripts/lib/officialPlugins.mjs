import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const catalogSchemaVersion = 'redeven.official_plugin_catalog.seed.v1';
export const officialPublisherID = 'com.redeven.official';

export function repoRootFrom(importMetaURL) {
  let current = path.dirname(new URL(importMetaURL).pathname);
  for (;;) {
    const packagePath = path.join(current, 'package.json');
    if (existsSync(packagePath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Unable to locate redeven-official-plugins package root');
    }
    current = parent;
  }
}

export async function readJSON(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

export async function fileExists(filename) {
  try {
    const info = await stat(filename);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function listPluginNames(repoRoot) {
  const dir = path.join(repoRoot, 'plugins');
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function loadPluginSource(repoRoot, name) {
  const pluginRoot = path.join(repoRoot, 'plugins', name);
  const manifestPath = path.join(pluginRoot, 'manifest.json');
  const manifest = await readJSON(manifestPath);
  return { name, pluginRoot, manifestPath, manifest };
}

export async function loadAllPluginSources(repoRoot) {
  const names = await listPluginNames(repoRoot);
  return Promise.all(names.map((name) => loadPluginSource(repoRoot, name)));
}

export function catalogItemForPlugin(source) {
  const plugin = source.manifest.plugin ?? {};
  const surface = (source.manifest.surfaces ?? [])[0] ?? {};
  const shortName = source.name;
  return {
    plugin_id: plugin.plugin_id,
    display_name: plugin.display_name,
    description: descriptionForPlugin(shortName),
    publisher_id: source.manifest.publisher?.publisher_id,
    latest_version: plugin.version,
    stable_version: plugin.version,
    min_redeven_version: minRedevenVersionForPlugin(shortName),
    min_redevplugin_version: minReDevPluginVersionForPlugin(shortName),
    rollout_state: 'stable',
    default_surface_id: surface.surface_id,
    icon_fallback: iconFallbackForPlugin(shortName),
    distribution: {
      release_channel: 'github_release_and_redeven_cdn',
      artifact_name: `${shortName}-${plugin.version}.redevplugin`,
      official_artifact_path: `official/${shortName}/${plugin.version}/${shortName}-${plugin.version}.redevplugin`,
    },
  };
}

export function buildCatalogSeed(sources) {
  return {
    schema_version: catalogSchemaVersion,
    publisher_id: officialPublisherID,
    generated_from: {
      repository: 'redeven-official-plugins',
      source: 'plugin_manifests',
    },
    plugins: sources.map(catalogItemForPlugin).sort((a, b) => a.plugin_id.localeCompare(b.plugin_id)),
  };
}

export function stableJSONString(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export async function validatePluginSource(source) {
  const errors = [];
  const { manifest, pluginRoot, name } = source;
  if (manifest.schema_version !== 'redevplugin.manifest.v1') {
    errors.push(`${name}: manifest schema_version must be redevplugin.manifest.v1`);
  }
  if (manifest.publisher?.publisher_id !== officialPublisherID) {
    errors.push(`${name}: publisher_id must be ${officialPublisherID}`);
  }
  const pluginID = String(manifest.plugin?.plugin_id ?? '');
  if (!pluginID.startsWith(`${officialPublisherID}.`)) {
    errors.push(`${name}: plugin_id must use the ${officialPublisherID} namespace`);
  }
  const surfaces = Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
  if (surfaces.length === 0) {
    errors.push(`${name}: at least one surface is required`);
  }
  for (const [index, surface] of surfaces.entries()) {
    const entry = String(surface.entry ?? '');
    if (!entry || entry.startsWith('/') || entry.includes('..')) {
      errors.push(`${name}: surfaces[${index}].entry must be package-local`);
      continue;
    }
    if (!(await fileExists(path.join(pluginRoot, entry)))) {
      errors.push(`${name}: surfaces[${index}].entry ${entry} is missing`);
    }
  }
  const bindings = Array.isArray(manifest.capability_bindings) ? manifest.capability_bindings : [];
  for (const method of manifest.methods ?? []) {
    const bindingID = method.route?.binding_id;
    if (method.route?.kind === 'capability' && !bindings.some((binding) => binding.binding_id === bindingID)) {
      errors.push(`${name}: method ${method.method} references unknown binding ${bindingID}`);
    }
  }
  return errors;
}

function descriptionForPlugin(name) {
  if (name === 'containers') {
    return "Manage Docker and Podman resources through Redeven's official container capability.";
  }
  return 'Redeven official plugin.';
}

function minRedevenVersionForPlugin(_name) {
  return '0.1.0';
}

function minReDevPluginVersionForPlugin(_name) {
  return '0.1.1';
}

function iconFallbackForPlugin(name) {
  if (name === 'containers') return 'containers';
  return 'generic';
}
