import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jsx } from '@floegence/redevplugin-ui/jsx-runtime';

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
});
