import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  buildCatalogSeed,
  loadAllPluginSources,
  readJSON,
  repoRootFrom,
  stableJSONString,
  validatePluginSource,
} from '../scripts/lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);

describe('official plugin repository contract', () => {
  it('documents the official-only boundary in AGENTS.md', async () => {
    const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    assert.match(agents, /First-party plugins only/);
    assert.match(agents, /Do not use `go\.work`/);
    assert.match(agents, /released ReDevPlugin CLI\/SDK\/contract/);
    assert.match(agents, /Do not create `backup\/\*` branches/);
  });

  it('keeps source manifests valid for the official namespace', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    assert.equal(sources.length, 1);
    const [containers] = sources;
    assert.equal(containers.name, 'containers');
    assert.equal(containers.manifest.publisher.publisher_id, 'com.redeven.official');
    assert.equal(containers.manifest.plugin.plugin_id, 'com.redeven.official.containers');
    assert.equal(containers.manifest.surfaces[0].entry, 'ui/index.html');
    assert.deepEqual(await validatePluginSource(containers), []);
  });

  it('declares the full Containers capability method contract', async () => {
    const manifest = await readJSON(path.join(repoRoot, 'plugins', 'containers', 'manifest.json'));
    const methods = new Map(manifest.methods.map((method) => [method.method, method]));

    assert.deepEqual([...methods.keys()], [
      'containers.status',
      'containers.list',
      'containers.inspect',
      'containers.start.preflight',
      'containers.start',
      'containers.stop',
      'containers.restart',
      'containers.remove',
      'containers.logs.tail',
      'images.pull',
    ]);

    for (const method of manifest.methods) {
      assert.equal(method.route?.kind, 'capability');
      assert.equal(method.route?.binding_id, 'container_runtime');
      assert.equal(method.route?.target_method, method.method);
      const engineSchema = method.request_schema?.properties?.engine;
      if (engineSchema) {
        assert.deepEqual(engineSchema.enum, ['docker', 'podman'], `${method.method} must accept Docker and Podman`);
        assert.ok(
          method.request_schema.required.includes('engine'),
          `${method.method} must require an explicit engine`,
        );
      }
    }

    assert.equal(methods.get('containers.status').effect, 'read');
    assert.equal(methods.get('containers.list').execution, 'sync');
    assert.equal(methods.get('containers.inspect').execution, 'sync');
    assert.equal(methods.get('containers.logs.tail').execution, 'subscription');
    assert.equal(methods.get('images.pull').effect, 'write');
    assert.equal(methods.get('images.pull').execution, 'operation');
    assert.deepEqual(
      methods.get('containers.list').response_schema.properties.containers.items.required,
      ['container_id'],
      'containers.list response items must expose canonical container_id',
    );
    assert.deepEqual(
      methods.get('containers.inspect').response_schema.properties.container.required,
      ['container_id'],
      'containers.inspect response must expose canonical container_id',
    );
    assert.deepEqual(
      methods.get('containers.logs.tail').response_schema.required,
      ['schema_version', 'capability_id', 'capability_version', 'engine', 'container_id', 'stream_id', 'stream_ticket'],
      'containers.logs.tail must return ReDevPlugin stream metadata for subscription delivery',
    );
    assert.equal(methods.get('containers.logs.tail').response_schema.properties.stream_id.type, 'string');
    assert.equal(methods.get('containers.logs.tail').response_schema.properties.stream_ticket.type, 'string');
    assert.equal(
      methods.get('containers.logs.tail').response_schema.properties.engine.enum.length,
      2,
      'log subscriptions must preserve the selected container engine',
    );
  });

  it('keeps intent payload schemas satisfiable and engine-aware', async () => {
    const manifest = await readJSON(path.join(repoRoot, 'plugins', 'containers', 'manifest.json'));

    for (const intent of manifest.intents) {
      const schema = intent.payload_schema;
      const required = Array.isArray(schema.required) ? schema.required : [];
      const properties = schema.properties ?? {};
      for (const field of required) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(properties, field),
          `${intent.intent_id} required field ${field} must be declared in properties`,
        );
      }
    }

    const intents = new Map(manifest.intents.map((intent) => [intent.intent_id, intent]));
    assert.deepEqual(intents.get('containers-start').payload_schema.properties.engine.enum, ['docker', 'podman']);
    assert.equal(intents.get('containers-start').payload_schema.properties.container_id.minLength, 1);
    assert.deepEqual(intents.get('containers-pull-image').payload_schema.properties.engine.enum, ['docker', 'podman']);
    assert.equal(intents.get('containers-pull-image').payload_schema.properties.image_ref.minLength, 1);
  });

  it('requires confirmation and stable cancellation policy for dangerous container actions', async () => {
    const manifest = await readJSON(path.join(repoRoot, 'plugins', 'containers', 'manifest.json'));
    const methods = new Map(manifest.methods.map((method) => [method.method, method]));

    assert.equal(methods.get('containers.start.preflight').preflight_only, true);
    assert.equal(methods.get('containers.start').confirmation?.mode, 'risk_based');
    assert.equal(methods.get('containers.start').confirmation?.preflight_method, 'containers.start.preflight');
    assert.equal(methods.get('containers.start').confirmation?.plan_hash_required, true);

    for (const methodName of ['containers.start', 'containers.stop', 'containers.restart', 'containers.remove']) {
      const method = methods.get(methodName);
      assert.equal(method.dangerous, true, `${methodName} must be dangerous`);
      assert.equal(method.execution, 'operation', `${methodName} must run as an operation`);
      assert.ok(method.confirmation, `${methodName} must declare confirmation`);
      assert.equal(method.cancel_policy?.cancelable, true, `${methodName} must be cancelable`);
      assert.equal(method.cancel_policy?.disable_behavior, 'cancel');
      assert.equal(method.cancel_policy?.uninstall_behavior, 'cancel_then_block_delete');
      assert.deepEqual(
        method.confirmation.request_hash_fields.slice(0, 3),
        ['schema_version', 'engine', 'container_id'],
        `${methodName} confirmation must bind engine and container_id`,
      );
    }
  });

  it('keeps the Containers UI on the sandbox bridge without direct host routes or wildcard origins', async () => {
    const [html, js] = await Promise.all([
      readFile(path.join(repoRoot, 'plugins', 'containers', 'ui', 'index.html'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'ui', 'main.js'), 'utf8'),
    ]);
    const source = `${html}\n${js}`;

    assert.doesNotMatch(source, /postMessage\([^)]*,\s*['"]\*['"]\s*\)/);
    assert.doesNotMatch(source, /\/_redeven_proxy|\/_redevplugin|gateway|runtime-control/i);
    assert.match(source, /allowedParentOrigin/);
    assert.match(source, /containerKey/);
    assert.match(source, /requireSelectedEngine/);
    assert.match(source, /Container response engine/);
    assert.doesNotMatch(source, /item\?\.id/);
    assert.match(source, /\/_redeven_plugin\/stream/);
    assert.match(source, /stream_ticket/);
    assert.match(source, /docker/);
    assert.match(source, /podman/);
  });

  it('keeps the Containers UI JavaScript syntactically valid', async () => {
    const source = await readFile(path.join(repoRoot, 'plugins', 'containers', 'ui', 'main.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: 'plugins/containers/ui/main.js' }));
  });

  it('generates the catalog seed from plugin manifests', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    const expected = buildCatalogSeed(sources);
    const actual = await readJSON(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'));
    assert.equal(stableJSONString(actual), stableJSONString(expected));
    assert.equal(actual.plugins[0].min_redeven_version, '0.1.0');
    assert.equal(actual.plugins[0].min_redevplugin_version, '0.1.1');
    assert.equal(actual.plugins[0].distribution.official_artifact_path, 'official/containers/1.0.0/containers-1.0.0.redevplugin');
    assert.equal(actual.plugins[0].distribution.package_url_template, undefined);
    assert.equal(actual.plugins[0].distribution.requires_host_distribution_install_api, undefined);
  });

  it('does not expose third-party or unsigned local install entries', async () => {
    const allText = await Promise.all([
      readFile(path.join(repoRoot, 'README.md'), 'utf8'),
      readFile(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'README.md'), 'utf8'),
    ]);
    const joined = allText.join('\n');
    assert.doesNotMatch(joined, /Install from URL|Install from file|Developer Mode|marketplace/i);
    assert.doesNotMatch(joined, /\.\.\/redevplugin|\.\.\/redeven/);
  });
});
