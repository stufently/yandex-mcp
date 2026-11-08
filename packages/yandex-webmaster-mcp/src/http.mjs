/**
 * HTTP-обвязка Вебмастера: ретраи 429/5xx и ошибка API с полями `status` и `body`.
 * Вынесена из index.mjs, чтобы поля ошибки после исчерпания ретраев проверялись тестом.
 */

export function apiError(status, text, message = `Webmaster API error (${status}): ${text.substring(0, 500)}`) {
  const error = new Error(message);
  error.status = status;
  try {
    error.body = JSON.parse(text);
  } catch {
    error.body = undefined;
  }
  return error;
}

export async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      if (attempt === maxRetries) throw new Error(`Network error after ${maxRetries} retries: ${err.message}`);
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        const text = await response.text();
        throw apiError(
          response.status,
          text,
          `API error (${response.status}) after ${maxRetries} retries: ${text.substring(0, 500)}`,
        );
      }
      const retryAfter = response.headers.get('Retry-After');
      const parsed = retryAfter
        ? Number.isFinite(Number(retryAfter))
          ? Number(retryAfter) * 1000
          : Math.max(0, new Date(retryAfter).getTime() - Date.now())
        : 0;
      const delay = parsed > 0 ? Math.min(parsed, 30000) : Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return response;
  }
}
