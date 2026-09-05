import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  importDocument,
  parseDocumentDSL,
  parseWorkspaceDSL,
  serializeDocumentDSL,
  serializeWorkspaceDSL,
} from '../ui/src/workspace-model.ts';

describe('Mind Map canonical DSL', () => {
  it('round-trips multiline text, blank lines, order, and folded state', () => {
    const workspace = createWorkspace(7);
    const document = workspace.documents[0];
    document.title = 'Project planning';
    document.nodes[0].title = 'Root\nsecond line';
    document.nodes.push({
      id: `${document.id}:node-2`,
      parent_id: document.nodes[0].id,
      order: 0,
      side: 'right',
      title: 'Research\n\n  details',
      color: 'blue',
      alignment: 'right',
      collapsed: true,
    });

    const dsl = serializeWorkspaceDSL(workspace);
    assert.match(dsl, /^mind-map 1\nkind: workspace\nselected: "map-7"\n\nmap "map-7"/u);
    assert.match(dsl, /      color: blue\n      alignment: right\n      folded: true\n      text: \|-\n        Research\n        \n          details\n/u);
    assert.deepEqual(parseWorkspaceDSL(dsl), workspace);
    assert.equal(serializeWorkspaceDSL(parseWorkspaceDSL(dsl)), dsl);
  });

  it('upgrades DSL without alignment to centered canonical nodes', () => {
    const current = serializeWorkspaceDSL(createWorkspace(71));
    const legacy = current.replaceAll('    alignment: center\n', '');
    const parsed = parseWorkspaceDSL(legacy);

    assert.ok(parsed.documents[0].nodes.every((node) => node.alignment === 'center'));
    assert.match(serializeWorkspaceDSL(parsed), /    alignment: center\n/u);
    assert.throws(() => parseWorkspaceDSL(current.replace('alignment: center', 'alignment: justify')), /alignment/u);
  });

  it('exports one document as DSL and regenerates IDs when importing it', () => {
    const workspace = createWorkspace(8);
    const source = workspace.documents[0];
    source.nodes[0].title = 'Launch\nplan';
    const dsl = serializeDocumentDSL(source);
    assert.match(dsl, /^mind-map 1\nkind: document\n\nmap /u);
    const parsed = parseDocumentDSL(dsl);
    const imported = importDocument(dsl, workspace, 81);
    assert.equal(parsed.nodes[0].title, 'Launch\nplan');
    assert.equal(imported.nodes[0].title, 'Launch\nplan');
    assert.notEqual(imported.id, source.id);
    assert.ok(imported.nodes.every((node) => !source.nodes.some((candidate) => candidate.id === node.id)));
  });

  it('rejects unknown fields, tabs, duplicate IDs, malformed indentation, and invalid blocks', () => {
    const valid = serializeWorkspaceDSL(createWorkspace(9));
    assert.throws(() => parseWorkspaceDSL(valid.replace('kind: workspace', 'kind: workspace\nunknown: true')), /unknown|expected/u);
    assert.throws(() => parseWorkspaceDSL(valid.replace('  title:', '\ttitle:')), /tab/u);
    assert.throws(() => parseWorkspaceDSL(valid.replace('  title:', '   title:')), /indent/u);
    assert.throws(() => parseWorkspaceDSL(valid.replace(/(  node "[^"]+")/u, '$1\n$1')), /duplicate|expected|invalid/u);
    assert.throws(() => parseWorkspaceDSL(valid.replace('    text: |-', '    text: |')), /text/u);
  });

  it('accepts legacy document JSON only as an import migration input', () => {
    const workspace = createWorkspace(10);
    const legacyDocument = structuredClone(workspace.documents[0]);
    for (const node of legacyDocument.nodes) delete node.alignment;
    const legacy = JSON.stringify(legacyDocument);
    const parsed = parseDocumentDSL(legacy);
    assert.equal(parsed.schema_version, 'mind-map.document.v1');
    assert.equal(parsed.nodes[0].alignment, 'center');
    assert.match(serializeDocumentDSL(parsed), /^mind-map 1/u);
    assert.throws(() => parseWorkspaceDSL(JSON.stringify(workspace)), /mind-map 1/u);

    const multiline = structuredClone(legacyDocument);
    multiline.nodes[0].title = 'legacy\nnewline';
    assert.throws(() => parseDocumentDSL(JSON.stringify(multiline)), /legacy|node/u);

    const oversized = structuredClone(legacyDocument);
    oversized.nodes[0].title = 'x'.repeat(121);
    assert.throws(() => parseDocumentDSL(JSON.stringify(oversized)), /legacy|node/u);

    const extended = { ...structuredClone(legacyDocument), unknown: true };
    assert.throws(() => parseDocumentDSL(JSON.stringify(extended)), /legacy|document/u);
  });
});
