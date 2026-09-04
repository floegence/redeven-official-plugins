import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsx } from '@floegence/redevplugin-ui/jsx-runtime';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Mind Map surface policy', () => {
  it('uses SDK-valid controls for resizing the sidebar', () => {
    assert.doesNotThrow(() => jsx('div', {
      className: 'sidebar-resizer',
      children: [
        jsx('button', {
          type: 'button',
          title: 'Narrow map sidebar',
          'aria-label': 'Narrow map sidebar',
          disabled: false,
          'data-redevplugin-action': 'narrow-sidebar',
        }, 'narrow-sidebar'),
        jsx('button', {
          type: 'button',
          title: 'Widen map sidebar',
          'aria-label': 'Widen map sidebar',
          disabled: false,
          'data-redevplugin-action': 'widen-sidebar',
        }, 'widen-sidebar'),
      ],
    }, 'sidebar-resizer'));
  });

  it('keeps the node title editor within the published Surface attribute policy', async () => {
    const app = await readFile(path.join(root, 'ui', 'src', 'app.tsx'), 'utf8');
    const editor = app.match(/<textarea\s+key=\{NODE_TITLE_INPUT_KEY\}[\s\S]*?<\/textarea>/u)?.[0];
    assert.ok(editor, 'node title editor textarea must remain present');
    assert.doesNotMatch(editor, /\sautocomplete=/u);

    assert.doesNotThrow(() => jsx('form', {
      className: 'node-title-editor color-accent',
      autocomplete: 'off',
      'data-redevplugin-action': 'commit-node-title',
      children: jsx('textarea', {
        name: 'value',
        value: 'Topic',
        placeholder: 'Topic',
        maxlength: 2_048,
        autofocus: true,
        'aria-label': 'Topic',
        'data-redevplugin-action': 'edit-node-title',
        'data-redevplugin-escape-action': 'cancel-node-title',
      }, 'node-title-input'),
    }, 'node-title-editor'));
  });
});
