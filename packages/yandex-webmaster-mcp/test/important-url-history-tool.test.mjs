import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';
import { listTools } from '../../../scripts/lib/list-tools.mjs';

test('important URL history exposes only host_id and url', async () => {
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'get-important-url-history');
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['host_id', 'url']);
  assert.deepEqual(tool.inputSchema.required.sort(), ['host_id', 'url']);
  assert.match(tool.description, /entire history/i);
  assert.match(tool.description, /no date range/i);
});

test('legacy dates are stripped and never sent to important URL history', async () => {
  const url = 'https://example.com/page?q=a&b=2';
  const body = { history: [{ update_date: '2026-10-01', indexing_status: 'INDEXED' }] };
  const result = await callTool(
    'yandex-webmaster-mcp',
    'get-important-url-history',
    { host_id: 'https:example.com:443', url, date_from: 'invalid legacy date', date_to: '2026-11-08' },
    [
      { match: '/v4/user', end: true, body: { user_id: 1 } },
      {
        match: `/important-urls/history?url=${encodeURIComponent(url)}`,
        end: true,
        method: 'GET',
        body,
      },
    ],
  );
  assert.ok(!result.isError, textOf(result));
  assert.deepEqual(result.structuredContent, body);
  assert.match(textOf(result), /2026-10-01/);
});
