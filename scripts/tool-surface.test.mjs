/**
 * Exact tool annotations and description rules for all five servers, read from
 * a live `tools/list` (fake credentials, no network).
 *
 * The annotations decide whether a client asks before running a tool, so a
 * writer marked read-only or a deleter without destructiveHint is a real bug,
 * not a style issue. That is why this checks the exact value of every hint for
 * every tool instead of only checking that annotations exist.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTools } from './lib/list-tools.mjs';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const READ_ONCE = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const EXPECTED = {
  'yandex-search-mcp': {
    search: READ,
  },
  'yandex-wordstat-mcp': {
    'get-regions-tree': READ,
    'get-region-children': READ,
    'top-requests': READ,
    dynamics: READ,
    regions: READ,
  },
  'yandex-webmaster-mcp': {
    'get-user': READ,
    'list-hosts': READ,
    'get-host': READ,
    'get-summary': READ,
    'get-sqi-history': READ,
    'get-diagnostics': READ,
    'get-popular-queries': READ,
    'get-query-history': READ,
    'get-indexing-history': READ,
    'get-indexing-samples': READ,
    'get-insearch-history': READ,
    'get-insearch-samples': READ,
    'get-search-events-history': READ,
    'get-search-events-samples': READ,
    'get-excluded-pages': READ,
    'get-external-links': READ,
    'get-external-links-history': READ,
    'get-broken-internal-links': READ,
    'get-broken-internal-links-history': READ,
    'get-sitemaps': READ,
    'get-sitemap': READ,
    'get-user-sitemaps': READ,
    'add-sitemap': WRITE,
    'get-important-urls': READ,
    'get-important-url-history': READ,
    'get-recrawl-quota': READ,
    'add-recrawl-url': WRITE,
    'get-recrawl-queue': READ,
    'get-recrawl-task': READ,
    'add-host': WRITE,
    'verify-host': READ,
    'start-verification': WRITE,
    'delete-host': DESTROY,
  },
  'yandex-metrika-mcp': {
    'get-counters': READ,
    'get-counter': READ,
    'get-goals': READ,
    'create-counter': WRITE,
    'delete-counter': DESTROY,
    'get-traffic-summary': READ,
    'get-traffic-sources': READ,
    'get-geography': READ,
    'get-devices': READ,
    'get-popular-pages': READ,
    'get-search-phrases': READ,
    'get-report': READ,
  },
  'yandex-direct-mcp': {
    get_campaigns: READ,
    add_campaigns: WRITE,
    update_campaigns: DESTROY,
    delete_campaigns: DESTROY,
    archive_campaigns: WRITE,
    unarchive_campaigns: WRITE,
    suspend_campaigns: WRITE,
    resume_campaigns: WRITE,
    get_adgroups: READ,
    add_adgroups: WRITE,
    update_adgroups: DESTROY,
    delete_adgroups: DESTROY,
    archive_adgroups: WRITE,
    unarchive_adgroups: WRITE,
    get_ads: READ,
    add_ads: WRITE,
    update_ads: DESTROY,
    delete_ads: DESTROY,
    archive_ads: WRITE,
    unarchive_ads: WRITE,
    moderate_ads: WRITE,
    get_keywords: READ,
    add_keywords: WRITE,
    update_keywords: DESTROY,
    delete_keywords: DESTROY,
    suspend_keywords: WRITE,
    resume_keywords: WRITE,
    get_keyword_bids: READ,
    set_keyword_bids: DESTROY,
    set_auto_keyword_bids: DESTROY,
    get_bid_modifiers: READ,
    add_bid_modifiers: WRITE,
    set_bid_modifiers: DESTROY,
    delete_bid_modifiers: DESTROY,
    get_sitelinks: READ,
    add_sitelinks: WRITE,
    delete_sitelinks: DESTROY,
    get_vcards: READ,
    add_vcards: WRITE,
    delete_vcards: DESTROY,
    create_report: READ_ONCE,
    get_dictionaries: READ,
    get_clients: READ,
  },
};

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

for (const [pkg, expected] of Object.entries(EXPECTED)) {
  test(`${pkg}: every tool has the exact expected annotations`, async () => {
    const tools = await listTools(pkg, { clientName: 'tool-surface-test' });
    assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(expected).sort());
    for (const tool of tools) {
      const got = Object.fromEntries(HINTS.map((key) => [key, tool.annotations?.[key]]));
      assert.deepEqual(got, expected[tool.name], `${pkg} ${tool.name}`);
    }
  });

  test(`${pkg}: every description says what the tool does, then when to use it`, async () => {
    const tools = await listTools(pkg, { clientName: 'tool-surface-test' });
    const leads = new Set();
    for (const tool of tools) {
      const text = String(tool.description ?? '');
      const lead = text.split(' Use when ')[0];
      assert.ok(
        lead.split(/\s+/).filter(Boolean).length >= 3,
        `${pkg} ${tool.name}: what-it-does sentence is too short`,
      );
      assert.ok(!leads.has(lead), `${pkg} ${tool.name}: what-it-does sentence repeats another tool`);
      leads.add(lead);
      const words = text.split(/\s+/).filter(Boolean);
      assert.ok(words.length >= 25, `${pkg} ${tool.name}: ${words.length} words`);
      assert.ok(!text.startsWith('Use when'), `${pkg} ${tool.name}: must start with what the tool does`);
      assert.match(text, /[.!?)] Use when \S/, `${pkg} ${tool.name}: needs a separate "Use when" sentence`);
      assert.equal(text.match(/Use when /g).length, 1, `${pkg} ${tool.name}: one "Use when" sentence`);
    }
  });
}
