export const STARTUP_LOAD_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

export async function loadWithRetry<T>(
  load: () => Promise<T>,
  wait: (delayMs: number) => Promise<boolean>,
  delays: readonly number[] = STARTUP_LOAD_RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
    }
    if (attempt === delays.length || !await wait(delays[attempt])) throw lastError;
  }
  throw lastError;
}
