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
  const releasePath = path.join(pluginRoot, 'release.json');
  const release = await readJSON(releasePath);
  return { name, pluginRoot, manifestPath, manifest, releasePath, release };
}

export async function loadAllPluginSources(repoRoot) {
  const names = await listPluginNames(repoRoot);
  return Promise.all(names.map((name) => loadPluginSource(repoRoot, name)));
}

export function catalogItemForPlugin(source) {
  const plugin = source.manifest.plugin ?? {};
  const stable = source.release.stable_catalog;
  return {
    plugin_id: plugin.plugin_id,
    publisher_id: source.manifest.publisher?.publisher_id,
    presentation: presentationCatalogForManifest(source.manifest),
    categories: [source.name],
    channels: [source.release.channel],
    latest: {
      version: stable.version,
      min_redeven_version: stable.min_redeven_version,
      min_redevplugin_version: stable.min_redevplugin_version,
      rollout_state: 'stable',
      default_surface_id: stable.default_surface_id,
      distribution: {
        provider: 'github_release',
        repository: stable.repository,
        tag: source.release.release_train_tag,
        artifact_name: stable.artifact_name,
        release_ref_asset_name: stable.release_ref_asset_name,
        trust_root_asset_name: stable.trust_root_asset_name,
      },
    },
  };
}

function presentationCatalogForManifest(manifest) {
  const presentation = manifest.presentation;
  const defaultLocaleTag = presentation.locales.default;
  const defaultLocale = {
    locale: defaultLocaleTag,
    name: manifest.plugin.display_name,
    ...(manifest.publisher.display_name ? { publisher_name: manifest.publisher.display_name } : {}),
    summary: manifest.plugin.display_name,
    description: [manifest.plugin.display_name],
    highlights: [],
    keywords: [manifest.plugin.display_name],
    surfaces: manifest.surfaces.map(({ surface_id, label }) => ({ surface_id, label })),
    settings: (manifest.settings?.fields ?? []).map(({ key, label, options = [] }) => ({ key, label, options })),
  };
  return {
    default_locale: defaultLocaleTag,
    locales: [defaultLocale],
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
  if (manifest.schema_version !== 'redevplugin.manifest.v9') {
    errors.push(`${name}: manifest schema_version must be redevplugin.manifest.v9`);
  }
  if (manifest.publisher?.publisher_id !== officialPublisherID) {
    errors.push(`${name}: publisher_id must be ${officialPublisherID}`);
  }
  const pluginID = String(manifest.plugin?.plugin_id ?? '');
  if (!pluginID.startsWith(`${officialPublisherID}.`)) {
    errors.push(`${name}: plugin_id must use the ${officialPublisherID} namespace`);
  }
  const presentation = manifest.presentation;
  if (!presentation || typeof presentation.locales?.default !== 'string') {
    errors.push(`${name}: manifest v9 presentation locale is incomplete`);
  } else {
    const iconPath = String(presentation.icon?.path ?? '');
    const iconSource = String(source.release?.package_assets?.[iconPath] ?? iconPath);
    if (!iconPath || iconPath.startsWith('/') || iconPath.includes('..') ||
        iconSource.startsWith('/') || iconSource.includes('..') ||
        !(await fileExists(path.join(pluginRoot, iconSource)))) {
      errors.push(`${name}: presentation.icon.path must be a package-local file`);
    }
  }
  if (source.release?.schema_version !== 'redeven.official_plugin_source_release.v1' ||
      source.release?.channel !== 'stable' || source.release?.source_version !== manifest.plugin?.version ||
      source.release?.release_train_tag !== `v${manifest.plugin?.version}`) {
    errors.push(`${name}: stable release train metadata is invalid`);
  }
  const stable = source.release?.stable_catalog;
  if (!stable || stable.version !== manifest.plugin?.version ||
      stable.repository !== 'floegence/redeven-official-plugins' ||
      !String(stable.artifact_name ?? '').endsWith('.redevplugin') ||
      stable.artifact_name !== `${name}-${stable.version}.redevplugin` ||
      stable.release_ref_asset_name !== `${name}-${stable.version}.release-ref.json` ||
      stable.trust_root_asset_name !== 'root.public.json') {
    errors.push(`${name}: GitHub release catalog metadata is invalid`);
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
    const icon = String(surface.icon ?? '');
    const iconSource = String(source.release?.package_assets?.[icon] ?? icon);
    if (!icon || icon.startsWith('/') || icon.includes('..') ||
        iconSource.startsWith('/') || iconSource.includes('..') ||
        !(await fileExists(path.join(pluginRoot, iconSource)))) {
      errors.push(`${name}: surfaces[${index}].icon must be a package-local file`);
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
