import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithRetry } from '../ui/src/startup-load.ts';

describe('Mind Map startup loading', () => {
  it('retries a transient runtime rejection and returns only confirmed data', async () => {
    let attempts = 0;
    const waits = [];
    const result = await loadWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('runtime unavailable');
        return { revision: 9, documents: 2 };
      },
      async (delayMs) => { waits.push(delayMs); return true; },
      [10, 20, 30],
    );
    assert.deepEqual(result, { revision: 9, documents: 2 });
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [10, 20]);
  });

  it('fails closed after bounded retries instead of returning a default workspace', async () => {
    let attempts = 0;
    await assert.rejects(
      loadWithRetry(
        async () => { attempts += 1; throw new Error('runtime unavailable'); },
        async () => true,
        [10, 20],
      ),
      /runtime unavailable/u,
    );
    assert.equal(attempts, 3);
  });

  it('stops retrying when the surface is disposed', async () => {
    let attempts = 0;
    await assert.rejects(
      loadWithRetry(
        async () => { attempts += 1; throw new Error('runtime unavailable'); },
        async () => false,
        [10, 20],
      ),
      /runtime unavailable/u,
    );
    assert.equal(attempts, 1);
  });
});
