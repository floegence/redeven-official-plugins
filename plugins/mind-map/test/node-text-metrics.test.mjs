import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureNodeText } from '../ui/src/node-text-metrics.ts';

const measure = (value) => [...value].reduce((width, character) => width + (/^[\x00-\x7f]$/u.test(character) ? 7 : 14), 0);

describe('Mind Map node text metrics', () => {
  it('preserves explicit lines and grows node height', () => {
    const single = measureNodeText('Root', 0, measure);
    const multiple = measureNodeText('Root\nsecond line\nthird', 0, measure);
    assert.deepEqual(multiple.lines, ['Root', 'second line', 'third']);
    assert.ok(multiple.height > single.height);
  });

  it('wraps at word boundaries and falls back to Unicode graphemes', () => {
    const words = measureNodeText('alpha beta gamma delta epsilon zeta', 1, measure, 70);
    assert.ok(words.lines.length > 1);
    assert.equal(words.lines.join(''), 'alpha beta gamma delta epsilon zeta');
    const long = '研发方向🚀'.repeat(18);
    const wrapped = measureNodeText(long, 2, measure, 84);
    assert.ok(wrapped.lines.length > 2);
    assert.equal(wrapped.lines.join(''), long);
  });

  it('uses a 280px content ceiling without truncating text', () => {
    const text = 'x'.repeat(200);
    const metrics = measureNodeText(text, 2, measure);
    assert.ok(metrics.contentWidth <= 280);
    assert.equal(metrics.lines.join(''), text);
    assert.equal(metrics.truncated, false);
  });
});
