import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';

test('get-traffic-summary retries persistent 420 through the shared HTTP module', async () => {
  const result = await callTool(
    'yandex-metrika-mcp',
    'get-traffic-summary',
    { counter_id: 12345 },
    [{ match: '/stat/v1/data', status: 420, body: { message: 'rate limited' } }],
    { timeoutMs: 40000 },
  );
  assert.ok(result.isError);
  assert.match(textOf(result), /API error \(420\) after 3 retries:/);
  assert.match(textOf(result), /rate limited/);
});

// Лимиты окна и семафора в сервере не проверить вызовом тула без 201 запроса, поэтому
// подключение констант сверяется по исходнику (как `scripts/sdk-public-api.test.mjs`):
// мутант с `limit: 1000000` в index.mjs оставлял все поведенческие тесты зелёными.
test('index.mjs wires the quota constants into the shared HTTP module', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /createSemaphore\(METRIKA_MAX_CONCURRENT\)/);
  assert.match(src, /createSlidingWindow\(\{ limit: REPORT_QUOTA_LIMIT, windowMs: REPORT_QUOTA_WINDOW_MS \}\)/);
  assert.match(src, /isReportUrl: \(url\) => url\.startsWith\(`\$\{STAT_API\}\/data`\)/);
});
