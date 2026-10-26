/** Run `fn` and retry while it fails, up to `tries` total attempts. */
export async function attempt(fn, { tries = 3, delayMs = 0 } = {}) {
  let lastError = null;
  for (let i = 0; i <= tries; i += 1) {
    try {
      return await fn(i);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
