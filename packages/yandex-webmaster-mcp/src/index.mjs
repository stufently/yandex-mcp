#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const command = process.argv[2];
if (command === 'auth') {
  const { runAuth } = await import('./auth.mjs');
  await runAuth();
} else {
  await runServer();
}

async function runServer() {
  const API_BASE = 'https://api.webmaster.yandex.net/v4';

  function getToken() {
    const token = process.env.YANDEX_WEBMASTER_TOKEN;
    if (!token)
      throw new Error('YANDEX_WEBMASTER_TOKEN is required. Run `npx yandex-webmaster-mcp auth` or set it manually.');
    return token;
  }

  // --- Shared utilities ---

  async function fetchWithRetry(url, options, maxRetries = 3) {
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
          throw new Error(`API error (${response.status}) after ${maxRetries} retries: ${text.substring(0, 500)}`);
        }
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return response;
    }
  }

  async function safeJsonParse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from API: ${text.substring(0, 200)}`);
    }
  }

  function validateDate(dateStr) {
    if (!dateStr) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD.`);
    }
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
    const [y, m, day] = dateStr.split('-').map(Number);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
      throw new Error(`Invalid calendar date: ${dateStr}`);
    }
    return dateStr;
  }

  // --- User ID Cache ---

  let cachedUserId = null;

  async function getUserId() {
    if (cachedUserId) return cachedUserId;
    const data = await apiRequest('/user');
    cachedUserId = data.user_id;
    return cachedUserId;
  }

  // --- API Request ---

  async function apiRequest(endpoint, queryParams = {}) {
    const url = new URL(`${API_BASE}${endpoint}`);
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(key, v);
        } else {
          url.searchParams.set(key, value);
        }
      }
    }

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `OAuth ${getToken()}`,
      },
    });

    if (!response.ok) {
      // Invalidate user_id cache on auth errors
      if (response.status === 401 || response.status === 403) {
        cachedUserId = null;
      }
      const errorText = await response.text();
      throw new Error(`Webmaster API error (${response.status}): ${errorText.substring(0, 500)}`);
    }

    return safeJsonParse(response);
  }

  // --- URL builder helpers ---

  async function hostUrl(hostId, suffix = '') {
    const userId = await getUserId();
    return `/user/${userId}/hosts/${hostId}${suffix}`;
  }

  function dateParams(dateFrom, dateTo) {
    const params = {};
    const vFrom = validateDate(dateFrom);
    const vTo = validateDate(dateTo);
    if (vFrom) params.date_from = new Date(vFrom).toISOString();
    if (vTo) params.date_to = new Date(vTo).toISOString();
    return params;
  }

  function paginationParams(limit, offset) {
    const params = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    return params;
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-webmaster', version: '1.0.0' });

  // === Core (3 tools) ===

  // 1. get-user
  server.tool('get-user', 'Get current Webmaster user info and user_id.', {}, async () => {
    const data = await apiRequest('/user');
    cachedUserId = data.user_id;
    return {
      content: [{ type: 'text', text: `User ID: ${data.user_id}` }],
      structuredContent: data,
    };
  });

  // 2. list-hosts
  server.tool('list-hosts', 'List all verified hosts (sites) in Webmaster.', {}, async () => {
    const userId = await getUserId();
    const data = await apiRequest(`/user/${userId}/hosts`);
    const hosts = data.hosts || [];
    const summary = hosts
      .map((h) => `${h.unicode_host_url || h.host_id} [${h.verified ? 'verified' : 'unverified'}]`)
      .join('\n');
    return {
      content: [{ type: 'text', text: `${hosts.length} hosts:\n${summary}` }],
      structuredContent: data,
    };
  });

  // 3. get-host
  server.tool(
    'get-host',
    'Get details for a specific host.',
    {
      host_id: z.string().describe('Host ID (URL-encoded, e.g. "https:example.com:443")'),
    },
    async ({ host_id }) => {
      const data = await apiRequest(await hostUrl(host_id));
      return {
        content: [
          {
            type: 'text',
            text: `Host: ${data.unicode_host_url || host_id}\nVerified: ${data.verified}\nStatus: ${data.host_data_status}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // === Statistics (2 tools) ===

  // 4. get-summary
  server.tool(
    'get-summary',
    'Get site summary: SQI, pages count, problems.',
    {
      host_id: z.string().describe('Host ID'),
    },
    async ({ host_id }) => {
      const data = await apiRequest(await hostUrl(host_id, '/summary'));
      const sp = data.site_problems || {};
      return {
        content: [
          {
            type: 'text',
            text: `SQI: ${data.sqi || 'N/A'} | Searchable: ${data.searchable_pages_count || 0} | Excluded: ${data.excluded_pages_count || 0}\nProblems: FATAL=${sp.FATAL || 0}, CRITICAL=${sp.CRITICAL || 0}, POSSIBLE=${sp.POSSIBLE_PROBLEM || 0}, RECOMMENDATION=${sp.RECOMMENDATION || 0}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // 5. get-sqi-history
  server.tool(
    'get-sqi-history',
    'Get SQI (Site Quality Index) history over time.',
    {
      host_id: z.string().describe('Host ID'),
      date_from: z.string().optional().describe('Start date YYYY-MM-DD'),
      date_to: z.string().optional().describe('End date YYYY-MM-DD'),
    },
    async ({ host_id, date_from, date_to }) => {
      const data = await apiRequest(await hostUrl(host_id, '/sqi-history'), dateParams(date_from, date_to));
      const points = data.points || [];
      return {
        content: [
          {
            type: 'text',
            text: `SQI history: ${points.length} data points.${points.length > 0 ? ` Latest: ${points[points.length - 1].value} (${points[points.length - 1].date})` : ''}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // === Diagnostics (1 tool) ===

  // 6. get-diagnostics
  server.tool(
    'get-diagnostics',
    'Get site diagnostics and problems.',
    {
      host_id: z.string().describe('Host ID'),
    },
    async ({ host_id }) => {
      const data = await apiRequest(await hostUrl(host_id, '/diagnostics'));
      return {
        content: [
          { type: 'text', text: `Diagnostics for host: ${JSON.stringify(data.problems || {}).substring(0, 500)}` },
        ],
        structuredContent: data,
      };
    },
  );

  // === Search Queries (2 tools) ===

  // 7. get-popular-queries
  server.tool(
    'get-popular-queries',
    'Get popular search queries for a site.',
    {
      host_id: z.string().describe('Host ID'),
      order_by: z.enum(['TOTAL_SHOWS', 'TOTAL_CLICKS']).describe('Sort by shows or clicks'),
      device_type: z
        .enum(['ALL', 'DESKTOP', 'MOBILE', 'TABLET', 'MOBILE_AND_TABLET'])
        .optional()
        .describe('Device filter'),
      date_from: z.string().optional().describe('Start date YYYY-MM-DD'),
      date_to: z.string().optional().describe('End date YYYY-MM-DD'),
      limit: z.number().min(1).max(500).optional().describe('Results limit (default: 100)'),
      offset: z.number().min(0).optional().describe('Offset'),
    },
    async ({ host_id, order_by, device_type, date_from, date_to, limit = 100, offset }) => {
      const params = {
        ...dateParams(date_from, date_to),
        ...paginationParams(limit, offset),
        order_by,
        query_indicator: ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION', 'AVG_CLICK_POSITION'],
      };
      if (device_type) params.device_type_indicator = device_type;

      const data = await apiRequest(await hostUrl(host_id, '/search-queries/popular'), params);
      const queries = data.queries || [];
      const summary = queries
        .slice(0, 20)
        .map(
          (q, i) =>
            `${i + 1}. "${q.query_text}" — shows: ${q.indicators?.TOTAL_SHOWS || 0}, clicks: ${q.indicators?.TOTAL_CLICKS || 0}`,
        )
        .join('\n');
      return {
        content: [{ type: 'text', text: `Popular queries (${queries.length} results):\n${summary}` }],
        structuredContent: data,
      };
    },
  );

  // 8. get-query-history
  server.tool(
    'get-query-history',
    'Get search query totals history.',
    {
      host_id: z.string().describe('Host ID'),
      device_type: z.enum(['ALL', 'DESKTOP', 'MOBILE', 'TABLET', 'MOBILE_AND_TABLET']).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, device_type, date_from, date_to }) => {
      const params = {
        ...dateParams(date_from, date_to),
        query_indicator: ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION', 'AVG_CLICK_POSITION'],
      };
      if (device_type) params.device_type_indicator = device_type;

      const data = await apiRequest(await hostUrl(host_id, '/search-queries/all/history'), params);
      return {
        content: [{ type: 'text', text: `Query history: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // === Indexing (4 tools) ===

  // 9. get-indexing-history
  server.tool(
    'get-indexing-history',
    'Get indexing history over time.',
    {
      host_id: z.string().describe('Host ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, date_from, date_to }) => {
      const data = await apiRequest(await hostUrl(host_id, '/indexing/history'), dateParams(date_from, date_to));
      return {
        content: [{ type: 'text', text: `Indexing history: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // 10. get-indexing-samples
  server.tool(
    'get-indexing-samples',
    'Get sample indexed URLs.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, limit, offset }) => {
      const data = await apiRequest(await hostUrl(host_id, '/indexing/samples'), paginationParams(limit, offset));
      const samples = data.samples || [];
      return {
        content: [{ type: 'text', text: `Indexing samples: ${samples.length} URLs.` }],
        structuredContent: data,
      };
    },
  );

  // 11. get-insearch-history
  server.tool(
    'get-insearch-history',
    'Get in-search (appearing in results) history.',
    {
      host_id: z.string().describe('Host ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, date_from, date_to }) => {
      const data = await apiRequest(
        await hostUrl(host_id, '/indexing/insearch/history'),
        dateParams(date_from, date_to),
      );
      return {
        content: [{ type: 'text', text: `In-search history: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // 12. get-insearch-samples
  server.tool(
    'get-insearch-samples',
    'Get sample URLs appearing in search.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, limit, offset }) => {
      const data = await apiRequest(
        await hostUrl(host_id, '/indexing/insearch/samples'),
        paginationParams(limit, offset),
      );
      const samples = data.samples || [];
      return {
        content: [{ type: 'text', text: `In-search samples: ${samples.length} URLs.` }],
        structuredContent: data,
      };
    },
  );

  // === Search Events (2 tools) ===

  // 13. get-search-events-history
  server.tool(
    'get-search-events-history',
    'Get search URL events history (appeared/removed).',
    {
      host_id: z.string().describe('Host ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, date_from, date_to }) => {
      const data = await apiRequest(
        await hostUrl(host_id, '/search-urls/events/history'),
        dateParams(date_from, date_to),
      );
      return {
        content: [{ type: 'text', text: `Search events history: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // 14. get-search-events-samples
  server.tool(
    'get-search-events-samples',
    'Get sample URLs for search events.',
    {
      host_id: z.string().describe('Host ID'),
      event_type: z.enum(['APPEARED', 'REMOVED']).describe('Event type'),
      limit: z.number().min(1).max(100).optional().describe('Limit (default: 10)'),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, event_type, limit = 10, offset }) => {
      const data = await apiRequest(await hostUrl(host_id, '/search-urls/events/samples'), {
        ...paginationParams(limit, offset),
        event_type,
      });
      const samples = data.samples || [];
      return {
        content: [{ type: 'text', text: `${event_type} events: ${samples.length} sample URLs.` }],
        structuredContent: data,
      };
    },
  );

  // === Links (4 tools) ===

  // 15. get-external-links
  server.tool(
    'get-external-links',
    'Get external links pointing to the site.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, limit, offset }) => {
      const data = await apiRequest(await hostUrl(host_id, '/links/external/samples'), paginationParams(limit, offset));
      const links = data.links || [];
      return {
        content: [{ type: 'text', text: `External links: ${links.length} samples.` }],
        structuredContent: data,
      };
    },
  );

  // 16. get-external-links-history
  server.tool(
    'get-external-links-history',
    'Get external links count history.',
    {
      host_id: z.string().describe('Host ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, date_from, date_to }) => {
      const data = await apiRequest(await hostUrl(host_id, '/links/external/history'), dateParams(date_from, date_to));
      return {
        content: [{ type: 'text', text: `External links history: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // 17. get-broken-internal-links
  server.tool(
    'get-broken-internal-links',
    'Get broken internal links.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, limit, offset }) => {
      const data = await apiRequest(await hostUrl(host_id, '/links/internal/samples'), paginationParams(limit, offset));
      const links = data.links || [];
      return {
        content: [{ type: 'text', text: `Broken internal links: ${links.length} samples.` }],
        structuredContent: data,
      };
    },
  );

  // 18. get-broken-internal-links-history
  server.tool(
    'get-broken-internal-links-history',
    'Get broken internal links count history.',
    {
      host_id: z.string().describe('Host ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, date_from, date_to }) => {
      const data = await apiRequest(await hostUrl(host_id, '/links/internal/history'), dateParams(date_from, date_to));
      return {
        content: [{ type: 'text', text: `Broken internal links history: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // === Sitemaps (3 tools) ===

  // 19. get-sitemaps
  server.tool(
    'get-sitemaps',
    'List all sitemaps for a host.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
    },
    async ({ host_id, limit }) => {
      const params = {};
      if (limit) params.limit = limit;
      const data = await apiRequest(await hostUrl(host_id, '/sitemaps'), params);
      const sitemaps = data.sitemaps || [];
      return {
        content: [{ type: 'text', text: `${sitemaps.length} sitemaps found.` }],
        structuredContent: data,
      };
    },
  );

  // 20. get-sitemap
  server.tool(
    'get-sitemap',
    'Get details for a specific sitemap.',
    {
      host_id: z.string().describe('Host ID'),
      sitemap_id: z.string().describe('Sitemap ID (URL-encoded)'),
    },
    async ({ host_id, sitemap_id }) => {
      const encodedSitemapId = encodeURIComponent(sitemap_id);
      const data = await apiRequest(await hostUrl(host_id, `/sitemaps/${encodedSitemapId}`));
      return {
        content: [
          {
            type: 'text',
            text: `Sitemap: ${sitemap_id}\nURLs: ${data.urls_count || 'N/A'}\nLast checked: ${data.last_check_date || 'N/A'}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // 21. get-user-sitemaps
  server.tool(
    'get-user-sitemaps',
    'List user-added sitemaps.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
    },
    async ({ host_id, limit }) => {
      const params = {};
      if (limit) params.limit = limit;
      const data = await apiRequest(await hostUrl(host_id, '/user-added-sitemaps'), params);
      const sitemaps = data.sitemaps || [];
      return {
        content: [{ type: 'text', text: `${sitemaps.length} user-added sitemaps.` }],
        structuredContent: data,
      };
    },
  );

  // === Important URLs (2 tools) ===

  // 22. get-important-urls
  server.tool(
    'get-important-urls',
    'Get important URLs for a site.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, limit, offset }) => {
      const data = await apiRequest(await hostUrl(host_id, '/important-urls'), paginationParams(limit, offset));
      const urls = data.urls || [];
      return {
        content: [{ type: 'text', text: `Important URLs: ${urls.length} results.` }],
        structuredContent: data,
      };
    },
  );

  // 23. get-important-url-history
  server.tool(
    'get-important-url-history',
    'Get history for a specific important URL.',
    {
      host_id: z.string().describe('Host ID'),
      url: z.string().describe('URL to get history for'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
    async ({ host_id, url: targetUrl, date_from, date_to }) => {
      const data = await apiRequest(await hostUrl(host_id, '/important-urls/history'), {
        ...dateParams(date_from, date_to),
        url: targetUrl,
      });
      return {
        content: [{ type: 'text', text: `URL history for ${targetUrl}: ${(data.points || []).length} data points.` }],
        structuredContent: data,
      };
    },
  );

  // === Recrawl (1 tool) ===

  // 24. get-recrawl-quota
  server.tool(
    'get-recrawl-quota',
    'Get recrawl quota for a host.',
    {
      host_id: z.string().describe('Host ID'),
    },
    async ({ host_id }) => {
      const data = await apiRequest(await hostUrl(host_id, '/recrawl/quota'));
      return {
        content: [
          {
            type: 'text',
            text: `Recrawl quota: ${data.daily_quota || 'N/A'} daily, ${data.quota_remainder || 'N/A'} remaining.`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('yandex-webmaster-mcp running on stdio');
}
