/**
 * Ошибка Вебмастера после исчерпания ретраев обязана нести `status` и `body`, как и
 * ошибка прямого не-2xx: по ним хендлеры различают ответы API (`add-sitemap` и 409).
 * Сеть не трогается: глобальный `fetch` подменяется на время теста.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { apiError, fetchWithRetry } from '../src/http.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status, text) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(text, { status });
  };
  return calls;
}

test('после исчерпания ретраев 5xx ошибка несёт status и разобранный JSON body', async () => {
  const body = { error_code: 'INTERNAL_ERROR', error_message: 'boom' };
  const calls = stubFetch(503, JSON.stringify(body));
  const err = await fetchWithRetry('https://api.test/x', {}, 0).then(
    () => assert.fail('ожидалась ошибка'),
    (e) => e,
  );
  assert.equal(calls.length, 1);
  assert.equal(err.message, `API error (503) after 0 retries: ${JSON.stringify(body)}`);
  assert.equal(err.status, 503);
  assert.deepEqual(err.body, body);
});

test('после исчерпания ретраев 429 с не-JSON телом: status есть, body undefined', async () => {
  stubFetch(429, 'Too Many Requests');
  const err = await fetchWithRetry('https://api.test/x', {}, 0).then(
    () => assert.fail('ожидалась ошибка'),
    (e) => e,
  );
  assert.equal(err.status, 429);
  assert.ok('body' in err, 'поле body обязано быть выставлено');
  assert.equal(err.body, undefined);
  assert.match(err.message, /^API error \(429\) after 0 retries: Too Many Requests$/);
});

test('apiError по умолчанию даёт прежний текст и обрезает тело до 500 символов', () => {
  const long = 'x'.repeat(600);
  const err = apiError(404, long);
  assert.equal(err.message, `Webmaster API error (404): ${'x'.repeat(500)}`);
  assert.equal(err.status, 404);
  assert.equal(err.body, undefined);
});
