import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';

const URL = 'https://example.com/sitemap.xml';
const ID = 'c7-fe:80-c0';

function addSitemap(status, body) {
  return callTool('yandex-webmaster-mcp', 'add-sitemap', { host_id: 'https:example.com:443', url: URL }, [
    { match: '/v4/user', end: true, body: { user_id: 1 } },
    { match: '/user-added-sitemaps', end: true, method: 'POST', status, body },
  ]);
}

test('201 preserves the API response and marks a newly added sitemap', async () => {
  const result = await addSitemap(201, { sitemap_id: ID, extra: 'preserved' });
  assert.ok(!result.isError, textOf(result));
  assert.deepEqual(result.structuredContent, { sitemap_id: ID, extra: 'preserved', already_present: false, url: URL });
  assert.match(textOf(result), /Sitemap added/);
  assert.ok(textOf(result).includes(ID));
});

test('409 SITEMAP_ALREADY_ADDED returns the existing sitemap as success', async () => {
  const result = await addSitemap(409, { error_code: 'SITEMAP_ALREADY_ADDED', sitemap_id: ID });
  assert.ok(!result.isError, textOf(result));
  assert.deepEqual(result.structuredContent, { already_present: true, sitemap_id: ID, url: URL });
  assert.match(textOf(result), /already/i);
  assert.ok(textOf(result).includes(ID));
});

test('409 with another error code remains an error with the original text', async () => {
  const body = { error_code: 'OTHER_CONFLICT', sitemap_id: ID };
  const result = await addSitemap(409, body);
  assert.ok(result.isError);
  assert.equal(textOf(result), `Webmaster API error (409): ${JSON.stringify(body)}`);
});

test('404 HOST_NOT_VERIFIED remains an error', async () => {
  const body = { error_code: 'HOST_NOT_VERIFIED' };
  const result = await addSitemap(404, body);
  assert.ok(result.isError);
  assert.equal(textOf(result), `Webmaster API error (404): ${JSON.stringify(body)}`);
});

test('409 SITEMAP_ALREADY_ADDED without an id returns null', async () => {
  const result = await addSitemap(409, { error_code: 'SITEMAP_ALREADY_ADDED' });
  assert.ok(!result.isError, textOf(result));
  assert.deepEqual(result.structuredContent, { already_present: true, sitemap_id: null, url: URL });
  assert.match(textOf(result), /Sitemap ID: null/);
});

test('the same error code on a non-409 response is still an error', async () => {
  const result = await addSitemap(400, { error_code: 'SITEMAP_ALREADY_ADDED', sitemap_id: ID });
  assert.ok(result.isError);
  assert.match(textOf(result), /^Webmaster API error \(400\):/);
});
