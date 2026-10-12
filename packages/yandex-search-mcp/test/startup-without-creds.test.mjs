/**
 * The server must start and list its tool with no credentials at all — that is
 * how a client registers it before a key is set, and how the Docker image is
 * introspected (Glama). The missing key is reported by the tool call instead.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';
import { handshake } from '../../../scripts/lib/list-tools.mjs';

const NO_CREDS = { PATH: process.env.PATH ?? '' };

test('starts and lists its tool without YANDEX_SEARCH_API_KEY / YANDEX_FOLDER_ID', async () => {
  const { serverInfo, tools } = await handshake('yandex-search-mcp', { env: NO_CREDS });
  assert.equal(serverInfo?.name, 'yandex-search');
  assert.deepEqual(
    tools.map((t) => t.name),
    ['search'],
  );
});

test('a call without the API key names the missing variable and never reaches the network', async () => {
  const result = await callTool('yandex-search-mcp', 'search', { query: 'test' }, [], { env: NO_CREDS });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /YANDEX_SEARCH_API_KEY is required/);
});

test('a call with the key but no folder ID names the folder variable', async () => {
  const result = await callTool('yandex-search-mcp', 'search', { query: 'test' }, [], {
    env: { ...NO_CREDS, YANDEX_SEARCH_API_KEY: 'test' },
  });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /YANDEX_FOLDER_ID is required/);
});
