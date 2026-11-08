import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  createFetchWithRetry,
  createSemaphore,
  createSlidingWindow,
  isRetryableStatus,
  METRIKA_MAX_CONCURRENT,
  REPORT_QUOTA_LIMIT,
  REPORT_QUOTA_WINDOW_MS,
} from '../src/http.mjs';

const REPORT = 'https://api-metrica.yandex.net/stat/v1/data?ids=1';
const MANAGEMENT = 'https://api-metrica.yandex.net/management/v1/counters';
const isReportUrl = (url) => url.startsWith('https://api-metrica.yandex.net/stat/v1/data');
const response = (status = 200, body = 'ok', headers = {}) => new Response(body, { status, headers });

function makeFetch(options = {}) {
  return createFetchWithRetry({
    fetchImpl: async () => response(),
    sleep: async () => {},
    semaphore: createSemaphore(3),
    reportWindow: createSlidingWindow({ limit: 200, windowMs: 300000 }),
    isReportUrl,
    ...options,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('quota constants match the user limits', () => {
  assert.equal(METRIKA_MAX_CONCURRENT, 3);
  assert.equal(REPORT_QUOTA_LIMIT, 200);
  assert.equal(REPORT_QUOTA_WINDOW_MS, 300000);
});

test('retryable status boundaries include 420, 429 and all 5xx', () => {
  for (const status of [420, 429, 500, 503, 599, 600]) assert.equal(isRetryableStatus(status), true, `${status}`);
  for (const status of [200, 400, 419, 421, 428, 430, 499]) assert.equal(isRetryableStatus(status), false, `${status}`);
});

test('420 retries, forwards url and options, and preserves successful response contents', async () => {
  const calls = [];
  const sleeps = [];
  const final = response(202, 'accepted', { 'x-response-marker': 'preserved' });
  const options = { method: 'POST', body: 'payload' };
  const fetch = makeFetch({
    fetchImpl: async (...args) => {
      calls.push(args);
      return calls.length === 1 ? response(420) : final;
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  const result = await fetch(REPORT, options);
  assert.equal(result.status, 202);
  assert.equal(result.headers.get('x-response-marker'), 'preserved');
  assert.equal(await result.text(), 'accepted');
  assert.deepEqual(calls, [
    [REPORT, options],
    [REPORT, options],
  ]);
  assert.deepEqual(sleeps, [1000]);
});

test('429 retries with exponential backoff', async () => {
  let calls = 0;
  const sleeps = [];
  const fetch = makeFetch({
    fetchImpl: async () => response(++calls < 4 ? 429 : 200),
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal((await fetch(REPORT)).status, 200);
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
});

test('500 retries and exhaustion keeps status and the first 500 body characters', async () => {
  let calls = 0;
  const sleeps = [];
  const fetch = makeFetch({
    fetchImpl: async () => {
      calls++;
      return response(500, 'x'.repeat(501));
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  await assert.rejects(fetch(REPORT), { message: `API error (500) after 3 retries: ${'x'.repeat(500)}` });
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
});

test('499 is returned without retries or sleep', async () => {
  let calls = 0;
  const sleeps = [];
  const original = response(499, 'unchanged', { 'x-response-marker': 'preserved' });
  const fetch = makeFetch({
    fetchImpl: async () => {
      calls++;
      return original;
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  const result = await fetch(REPORT);
  assert.equal(result.status, 499);
  assert.equal(result.headers.get('x-response-marker'), 'preserved');
  assert.equal(await result.text(), 'unchanged');
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('network errors recover and exhaust using the same retry budget', async () => {
  let calls = 0;
  const sleeps = [];
  const fetch = makeFetch({
    fetchImpl: async () => {
      if (++calls !== 2) throw new Error('offline');
      return response();
    },
    sleep: async (ms) => sleeps.push(ms),
    maxRetries: 1,
  });
  assert.equal((await fetch(REPORT)).status, 200);
  await assert.rejects(fetch(REPORT), { message: 'Network error after 1 retries: offline' });
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [1000, 1000]);
});

test('zero retries makes exactly one attempt', async () => {
  let calls = 0;
  const sleeps = [];
  const fetch = makeFetch({
    fetchImpl: async () => {
      calls++;
      return response(420, 'limited');
    },
    sleep: async (ms) => sleeps.push(ms),
    maxRetries: 0,
  });
  await assert.rejects(fetch(REPORT), { message: 'API error (420) after 0 retries: limited' });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('numeric Retry-After overrides backoff and is capped at 30 seconds', async () => {
  const sleeps = [];
  const replies = [response(429, '', { 'Retry-After': '2.5' }), response(500, '', { 'Retry-After': '90' }), response()];
  const fetch = makeFetch({ fetchImpl: async () => replies.shift(), sleep: async (ms) => sleeps.push(ms) });
  await fetch(REPORT);
  assert.deepEqual(sleeps, [2500, 30000]);
});

test('HTTP-date Retry-After uses the current time', async (t) => {
  const now = Date.parse('2026-11-08T10:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const sleeps = [];
  const replies = [response(429, '', { 'Retry-After': 'Sun, 08 Nov 2026 10:00:07 GMT' }), response()];
  const fetch = makeFetch({ fetchImpl: async () => replies.shift(), sleep: async (ms) => sleeps.push(ms) });
  await fetch(REPORT);
  assert.deepEqual(sleeps, [7000]);
});

test('invalid, zero, negative and past Retry-After fall back to backoff capped at 10 seconds', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-08T10:00:00Z'));
  const sleeps = [];
  const values = ['invalid', '0', '-1', 'Sun, 08 Nov 2026 09:00:00 GMT', '', ''];
  const replies = [...values.map((value) => response(503, '', { 'Retry-After': value })), response()];
  await makeFetch({
    fetchImpl: async () => replies.shift(),
    sleep: async (ms) => sleeps.push(ms),
    maxRetries: 6,
  })(REPORT);
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 10000, 10000]);
});

test('network backoff is capped at 10 seconds', async () => {
  let calls = 0;
  const sleeps = [];
  await makeFetch({
    fetchImpl: async () => {
      if (++calls < 7) throw new Error('offline');
      return response();
    },
    sleep: async (ms) => sleeps.push(ms),
    maxRetries: 6,
  })(REPORT);
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 10000, 10000]);
});

test('semaphore reaches exactly max slots and starts queued work FIFO', async () => {
  const semaphore = createSemaphore(3);
  const gates = Array.from({ length: 6 }, deferred);
  const starts = [];
  let active = 0;
  let peak = 0;
  const jobs = gates.map((gate, i) =>
    semaphore.run(async () => {
      starts.push(i);
      peak = Math.max(peak, ++active);
      await gate.promise;
      active--;
      return i;
    }),
  );
  await setImmediate();
  assert.deepEqual(starts, [0, 1, 2]);
  gates[1].resolve();
  await jobs[1];
  await setImmediate();
  assert.deepEqual(starts, [0, 1, 2, 3]);
  gates[0].resolve();
  await jobs[0];
  await setImmediate();
  assert.deepEqual(starts, [0, 1, 2, 3, 4]);
  gates[2].resolve();
  await jobs[2];
  await setImmediate();
  assert.deepEqual(starts, [0, 1, 2, 3, 4, 5]);
  for (const gate of gates) gate.resolve();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test('semaphore releases slots on async and synchronous exceptions and preserves identity', async () => {
  const semaphore = createSemaphore(1);
  const gate = deferred();
  const error = new Error('failure');
  const first = semaphore.run(async () => {
    await gate.promise;
    throw error;
  });
  const rejected = assert.rejects(first, (err) => err === error);
  const second = semaphore.run(() => {
    throw error;
  });
  const rejectedSync = assert.rejects(second, (err) => err === error);
  const value = {};
  const third = semaphore.run(async () => value);
  gate.resolve();
  await Promise.all([rejected, rejectedSync]);
  assert.equal(await third, value);
});

test('sliding window expires a timestamp exactly at windowMs and does not record refusals', () => {
  let now = 100;
  const window = createSlidingWindow({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(window.tryAcquire(), 0);
  now = 200;
  assert.equal(window.tryAcquire(), 0);
  now = 1099;
  assert.equal(window.tryAcquire(), 1);
  now = 1100;
  assert.equal(window.tryAcquire(), 0);
  assert.equal(window.tryAcquire(), 100);
  now = 1200;
  assert.equal(window.tryAcquire(), 0);
  now = 2200;
  assert.equal(window.tryAcquire(), 0);
  assert.equal(window.tryAcquire(), 0);
});

test('sliding windows keep independent timestamp state', () => {
  const first = createSlidingWindow({ limit: 1, windowMs: 1000, now: () => 0 });
  const second = createSlidingWindow({ limit: 1, windowMs: 1000, now: () => 0 });
  assert.equal(first.tryAcquire(), 0);
  assert.equal(first.tryAcquire(), 1000);
  assert.equal(second.tryAcquire(), 0);
});

test('quota counts report URLs only and rejects without fetching or sleeping with rounded seconds', async () => {
  let now = 0;
  const calls = [];
  const sleeps = [];
  const fetch = makeFetch({
    fetchImpl: async (url) => {
      calls.push(url);
      return response();
    },
    sleep: async (ms) => sleeps.push(ms),
    reportWindow: createSlidingWindow({ limit: 200, windowMs: 300000, now: () => now }),
  });
  for (let i = 0; i < 201; i++) await fetch(MANAGEMENT);
  for (let i = 0; i < 200; i++) await fetch(REPORT);
  now = 1001;
  await assert.rejects(fetch(REPORT), (err) => {
    assert.match(err.message, /quota/i);
    assert.match(err.message, /200 requests \/ 5 min/);
    assert.match(err.message, /299 seconds/);
    return true;
  });
  assert.equal(calls.length, 401);
  assert.deepEqual(sleeps, []);
  assert.equal((await fetch(MANAGEMENT)).status, 200);
  now = 300000;
  assert.equal((await fetch(REPORT)).status, 200);
});

test('quota counts every retry including failed network attempts', async () => {
  for (const networkError of [false, true]) {
    let calls = 0;
    const sleeps = [];
    const fetch = makeFetch({
      fetchImpl: async () => {
        calls++;
        if (networkError) throw new Error('offline');
        return response(420);
      },
      sleep: async (ms) => sleeps.push(ms),
      reportWindow: createSlidingWindow({ limit: 2, windowMs: 300000, now: () => 0 }),
    });
    await assert.rejects(fetch(REPORT), /quota.*200 requests \/ 5 min.*300 seconds/i);
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1000, 2000]);
  }
});

test('all fetches share the semaphore, and both status and network retry sleeps release it', async () => {
  for (const networkError of [false, true]) {
    const sleepStarted = deferred();
    const wake = deferred();
    const calls = [];
    const fetch = makeFetch({
      semaphore: createSemaphore(1),
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          if (networkError) throw new Error('offline');
          return response(429);
        }
        return response();
      },
      sleep: async () => {
        sleepStarted.resolve();
        await wake.promise;
      },
    });
    const first = fetch(REPORT);
    await sleepStarted.promise;
    const second = fetch(MANAGEMENT);
    await setImmediate();
    assert.deepEqual(calls, [REPORT, MANAGEMENT]);
    assert.equal((await second).status, 200);
    wake.resolve();
    assert.equal((await first).status, 200);
    assert.deepEqual(calls, [REPORT, MANAGEMENT, REPORT]);
  }
});

test('fetch concurrency never exceeds the shared semaphore across report and management URLs', async () => {
  const gates = [deferred(), deferred(), deferred(), deferred()];
  let calls = 0;
  const fetch = makeFetch({
    semaphore: createSemaphore(3),
    fetchImpl: async () => {
      const gate = gates[calls++];
      await gate.promise;
      return response();
    },
  });
  const pending = [fetch(REPORT), fetch(MANAGEMENT), fetch(REPORT), fetch(MANAGEMENT)];
  await setImmediate();
  assert.equal(calls, 3);
  gates[0].resolve();
  await pending[0];
  await setImmediate();
  assert.equal(calls, 4);
  for (const gate of gates) gate.resolve();
  await Promise.all(pending);
});

test('queued report attempts acquire quota only when their semaphore slot starts', async () => {
  let now = 0;
  const window = createSlidingWindow({ limit: 1, windowMs: 300000, now: () => now });
  const acquisitionTimes = [];
  const semaphore = createSemaphore(1);
  const gate = deferred();
  const blocker = semaphore.run(() => gate.promise);
  const calls = [];
  const sleeps = [];
  const fetch = makeFetch({
    semaphore,
    reportWindow: {
      tryAcquire() {
        acquisitionTimes.push(now);
        return window.tryAcquire();
      },
    },
    fetchImpl: async (url) => {
      calls.push({ url, time: now });
      return response();
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  const queued = fetch(REPORT);
  await setImmediate();
  assert.deepEqual(calls, []);
  now = 300000;
  gate.resolve();
  await blocker;
  await queued;
  assert.deepEqual(acquisitionTimes, [300000], 'quota must be acquired at slot start');
  assert.deepEqual(calls, [{ url: REPORT, time: 300000 }]);
  now = 300001;
  const overflow = fetch(REPORT);
  const management = fetch(MANAGEMENT);
  await assert.rejects(overflow, {
    message: 'Local report quota exceeded (200 requests / 5 min); retry in 300 seconds.',
  });
  assert.equal((await management).status, 200, 'a quota refusal must release its slot');
  assert.deepEqual(calls, [
    { url: REPORT, time: 300000 },
    { url: MANAGEMENT, time: 300001 },
  ]);
  assert.deepEqual(sleeps, [], 'local quota refusals must not retry');
  now = 599999;
  await assert.rejects(fetch(REPORT), /retry in 1 seconds/);
  assert.equal(calls.length, 2);
  now = 600000;
  assert.equal((await fetch(REPORT)).status, 200);
});

test('all three semaphore slots remain occupied until slow response bodies finish', async (t) => {
  const controllers = [];
  const closed = new Set();
  const close = (i) => {
    if (!closed.has(i)) {
      controllers[i].close();
      closed.add(i);
    }
  };
  const calls = [];
  const fetch = makeFetch({
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(
        new ReadableStream({
          start(controller) {
            controllers.push(controller);
          },
        }),
        {
          status: 201,
          statusText: 'Created',
          headers: { 'x-response-marker': 'preserved' },
        },
      );
    },
  });
  const pending = [fetch(REPORT), fetch(MANAGEMENT), fetch(REPORT), fetch(MANAGEMENT)];
  const settled = [];
  pending.forEach((promise, i) => {
    promise.then(() => settled.push(i));
  });
  t.after(async () => {
    // Also release streams created by queued fetches while cleaning up a failed assertion.
    for (let i = 0; i < pending.length; i++) {
      await setImmediate();
      close(i);
    }
    await Promise.all(pending);
  });
  await setImmediate();
  assert.equal(calls.length, 3, 'the fourth fetch must wait for a complete body');
  assert.deepEqual(settled, [], 'headers alone must not resolve the request');
  const bytes = new Uint8Array([0, 255, 10, 65]);
  controllers[1].enqueue(bytes);
  await setImmediate();
  assert.equal(calls.length, 3, 'an unfinished body must still occupy its slot');
  close(1);
  const result = await pending[1];
  assert.equal(result.status, 201);
  assert.equal(result.statusText, 'Created');
  assert.equal(result.headers.get('x-response-marker'), 'preserved');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  await setImmediate();
  assert.equal(calls.length, 4);
});

test('failed body downloads retry and release the semaphore before sleeping', async () => {
  const semaphore = createSemaphore(1);
  const sleeps = [];
  let calls = 0;
  const fetch = makeFetch({
    semaphore,
    fetchImpl: async () => {
      if (++calls === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('body interrupted'));
            },
          }),
        );
      }
      return response(200, 'complete');
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      assert.equal(await semaphore.run(async () => 'slot available'), 'slot available');
    },
  });
  assert.equal(await (await fetch(REPORT)).text(), 'complete');
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
});

test('buffering preserves responses whose status forbids a body', async () => {
  for (const status of [204, 205, 304]) {
    const fetch = makeFetch({
      fetchImpl: async () => new Response(null, { status, headers: { 'x-response-marker': 'empty' } }),
    });
    const result = await fetch(MANAGEMENT);
    assert.equal(result.status, status);
    assert.equal(result.body, null);
    assert.equal(result.headers.get('x-response-marker'), 'empty');
    assert.equal(await result.text(), '');
  }
});
