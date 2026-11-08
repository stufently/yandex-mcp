export const METRIKA_MAX_CONCURRENT = 3;
export const REPORT_QUOTA_LIMIT = 200;
export const REPORT_QUOTA_WINDOW_MS = 300000;

export function isRetryableStatus(status) {
  return status === 420 || status === 429 || status >= 500;
}

export function createSemaphore(max) {
  let active = 0;
  const waiting = [];
  return {
    async run(fn) {
      if (active >= max) {
        await new Promise((resolve) => waiting.push(resolve));
      } else {
        active++;
      }
      try {
        return await fn();
      } finally {
        // Transfer the occupied slot directly to the oldest waiter.
        if (waiting.length) waiting.shift()();
        else active--;
      }
    },
  };
}

export function createSlidingWindow({ limit, windowMs, now = Date.now }) {
  const timestamps = [];
  return {
    tryAcquire() {
      const current = now();
      while (timestamps.length && current - timestamps[0] >= windowMs) timestamps.shift();
      if (timestamps.length >= limit) return timestamps[0] + windowMs - current;
      timestamps.push(current);
      return 0;
    },
  };
}

export function createFetchWithRetry({ fetchImpl, sleep, semaphore, reportWindow, isReportUrl, maxRetries = 3 }) {
  return async (url, options) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isReportUrl(url)) {
        const waitMs = reportWindow.tryAcquire();
        if (waitMs > 0) {
          throw new Error(
            `Local report quota exceeded (200 requests / 5 min); retry in ${Math.ceil(waitMs / 1000)} seconds.`,
          );
        }
      }
      let response;
      try {
        response = await semaphore.run(() => fetchImpl(url, options));
      } catch (err) {
        if (attempt === maxRetries) throw new Error(`Network error after ${maxRetries} retries: ${err.message}`);
        await sleep(Math.min(1000 * 2 ** attempt, 10000));
        continue;
      }
      if (isRetryableStatus(response.status)) {
        if (attempt === maxRetries) {
          const text = await response.text();
          throw new Error(`API error (${response.status}) after ${maxRetries} retries: ${text.substring(0, 500)}`);
        }
        const retryAfter = response.headers.get('Retry-After');
        const parsed = retryAfter
          ? Number.isFinite(Number(retryAfter))
            ? Number(retryAfter) * 1000
            : Math.max(0, new Date(retryAfter).getTime() - Date.now())
          : 0;
        await sleep(parsed > 0 ? Math.min(parsed, 30000) : Math.min(1000 * 2 ** attempt, 10000));
        continue;
      }
      return response;
    }
  };
}
