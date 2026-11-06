import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginRoot = path.join(dir, entry.name);
    const hasManifest = await fileExists(path.join(pluginRoot, 'manifest.json'));
    const hasRelease = await fileExists(path.join(pluginRoot, 'release.json'));
    if (hasManifest || hasRelease) names.push(entry.name);
  }
  return names.sort();
}

export async function loadPluginSource(repoRoot, name) {
  const pluginRoot = path.join(repoRoot, 'plugins', name);
  const packagePath = path.join(pluginRoot, 'package.json');
  const packageJSON = await readJSON(packagePath);
  const manifestPath = path.join(pluginRoot, 'manifest.json');
  const manifest = await readJSON(manifestPath);
  const releasePath = path.join(pluginRoot, 'release.json');
  const release = await readJSON(releasePath);
  return { name, pluginRoot, packagePath, packageJSON, manifestPath, manifest, releasePath, release };
}

export async function loadAllPluginSources(repoRoot) {
  const names = await listPluginNames(repoRoot);
  return Promise.all(names.map((name) => loadPluginSource(repoRoot, name)));
}

export function resolvePluginForReleaseTag(sources, tag) {
  const matches = sources.filter((source) => source.release?.release_train_tag === tag);
  if (matches.length !== 1) {
    throw new Error(`release tag ${tag} must match exactly one plugin; found ${matches.length}`);
  }
  return matches[0];
}

export function validatePluginCollection(sources) {
  const errors = [];
  collectDuplicateErrors(sources, (source) => source.manifest.plugin?.slug, 'plugin slug', errors);
  collectDuplicateErrors(sources, (source) => source.release?.release_train_tag, 'release tag', errors);
  return errors;
}

function collectDuplicateErrors(sources, valueFor, label, errors) {
  const owners = new Map();
  for (const source of sources) {
    const value = String(valueFor(source) ?? '');
    if (!value) continue;
    const names = owners.get(value) ?? [];
    names.push(source.name);
    owners.set(value, names);
  }
  for (const [value, names] of owners) {
    if (names.length > 1) errors.push(`duplicate ${label} ${value}: ${names.sort().join(', ')}`);
  }
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
  if (source.packageJSON?.version !== manifest.plugin?.version) {
    errors.push(`${name}: package version must match manifest version`);
  }
  for (const script of ['build', 'build:release', 'test', 'typecheck']) {
    if (typeof source.packageJSON?.scripts?.[script] !== 'string') {
      errors.push(`${name}: package script ${script} is required`);
    }
  }
  if (manifest.schema_version !== 'redevplugin.source.v1') {
    errors.push(`${name}: manifest schema_version must be redevplugin.source.v1`);
  }
  if (manifest.plugin?.slug !== name || 'plugin_id' in (manifest.plugin ?? {}) || 'publisher_id' in (manifest.publisher ?? {})) {
    errors.push(`${name}: author identity must contain only the plugin slug`);
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
      source.release?.release_train_tag !== `${name}-v${manifest.plugin?.version}`) {
    errors.push(`${name}: stable release train metadata is invalid`);
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
