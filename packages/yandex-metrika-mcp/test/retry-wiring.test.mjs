import assert from 'node:assert/strict';
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
