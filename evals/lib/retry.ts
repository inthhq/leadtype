const TRANSIENT_PATTERN =
  /timed?.?out|timeout|429|rate.?limit|server_error|internal server error|service unavailable|bad gateway|gateway timeout|temporarily unavailable|overloaded|capacity|too many requests|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|\b5\d\d\b/i;

/**
 * Heuristic: is this error a transient gateway/network hiccup worth retrying,
 * as opposed to a real failure (bad request, auth, schema)? Timeouts, rate
 * limits, and 5xx are transient; everything else is treated as terminal.
 */
export function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERN.test(message);
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_MS = 2000;

/**
 * Run `fn`, retrying on transient errors with exponential backoff. A real
 * (non-transient) error throws immediately. Used to keep a flaky gateway from
 * scoring a model/judge call as a task failure — infra noise must not pollute
 * the eval signal.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseMs?: number }
): Promise<T> {
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const baseMs = opts?.baseMs ?? DEFAULT_BASE_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isTransientError(err)) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, baseMs * 2 ** attempt)
      );
    }
  }
  throw lastError;
}
