#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CONFIRM_PARAM_DESCRIPTION, createDeleteHostHandler } from './confirm.mjs';
import { dateParams } from './dates.mjs';
import {
  collectExcludedPages,
  countExclusionReasons,
  EVENTS_SAMPLES_PAGE_SIZE,
  formatExcludedPages,
  formatExclusionReasons,
  selectExcludedPages,
} from './exclusions.mjs';
import { formatSeries, formatUrlHistory } from './series.mjs';

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
    // Never suggest `npx yandex-webmaster-mcp` — that unscoped name belongs to another
    // publisher, and this message appears while Yandex OAuth secrets are in the env.
    if (!token)
      throw new Error(
        `YANDEX_WEBMASTER_TOKEN is required. Run \`node "${process.argv[1] ?? 'src/index.mjs'}" auth\` or set it manually.`,
      );
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

  async function safeJsonParse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from API: ${text.substring(0, 200)}`);
    }
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

  async function apiRequestPost(endpoint, body) {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
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

  function omitKey(obj, key) {
    const { [key]: _dropped, ...rest } = obj;
    return rest;
  }

  function paginationParams(limit, offset) {
    const params = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    return params;
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-webmaster', version: '2.2.0' });

  /**
   * Регистрация ПИШУЩЕГО, но аддитивного тула.
   *
   * Аннотации проставляются явно, потому что в MCP умолчание у `destructiveHint` —
   * `true`: тул без аннотаций клиент вправе показать как разрушительный. Пока эти
   * три писателя заводились через `server.tool(...)`, добавление сайта, сайтмапа и
   * URL в очередь переобхода выглядели для клиента ровно так же опасно, как
   * `delete-host`, — и предупреждение обесценивалось на единственной операции, где
   * оно что-то значит.
   */
  function registerAdditiveWriteTool(name, { title, description, inputSchema }, handler) {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
        annotations: {
          title,
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      handler,
    );
  }

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
      // Dates first: hostUrl() can hit /user on a cold cache, and an invalid
      // range should not cost a network round trip before it is rejected.
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/sqi-history'), dates);
      return {
        content: [{ type: 'text', text: formatSeries('SQI history', data) }],
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
      // Без явных дат API сам выбирает окно (обычно последние 7 дней) и сообщает его
      // в date_from/date_to — молча выбрасывать это нельзя, иначе цифры не с чем соотнести.
      const window = data.date_from && data.date_to ? `, ${data.date_from} → ${data.date_to}` : '';
      const shown = queries.length > 20 ? ` (showing 20 of ${queries.length})` : '';
      return {
        content: [
          {
            type: 'text',
            text: `Popular queries: ${queries.length} of ${data.count ?? 'n/a'} total${window}${shown}\n${summary}`,
          },
        ],
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
        content: [{ type: 'text', text: formatSeries('Query history', data) }],
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
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/indexing/history'), dates);
      return {
        content: [{ type: 'text', text: formatSeries('Indexing history', data) }],
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
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/search-urls/in-search/history'), dates);
      return {
        content: [{ type: 'text', text: formatSeries('In-search history', data) }],
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
        await hostUrl(host_id, '/search-urls/in-search/samples'),
        paginationParams(limit, offset),
      );
      const samples = data.samples || [];
      return {
        content: [{ type: 'text', text: `In-search samples: ${samples.length} URLs (${data.count ?? 'n/a'} total).` }],
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
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/search-urls/events/history'), dates);
      return {
        content: [{ type: 'text', text: formatSeries('Search events history', data) }],
        structuredContent: data,
      };
    },
  );

  // 14. get-search-events-samples
  server.tool(
    'get-search-events-samples',
    'Get sample URLs for search events (appeared in / removed from search), with the reason each ' +
      'page was dropped (excluded_url_status). This is the only place API v4 exposes per-URL ' +
      'exclusion reasons — get-summary only has the aggregate excluded_pages_count. ' +
      'Note: the API has no server-side event filter, so event_type is applied to the fetched page ' +
      'and offset/limit still paginate the unfiltered stream.',
    {
      host_id: z.string().describe('Host ID'),
      event_type: z
        .enum(['APPEARED_IN_SEARCH', 'REMOVED_FROM_SEARCH'])
        .optional()
        .describe('Keep only events of this type (client-side filter; omit to get both)'),
      limit: z.number().min(1).max(100).optional().describe('Limit (default: 10)'),
      offset: z.number().min(0).optional(),
    },
    async ({ host_id, event_type, limit = 10, offset }) => {
      // event_type НЕ отправляем: API его молча игнорирует — любое значение, включая мусорное,
      // отдаёт одну и ту же смешанную выдачу (проверено на боевом API 2026-07-29).
      const data = await apiRequest(
        await hostUrl(host_id, '/search-urls/events/samples'),
        paginationParams(limit, offset),
      );
      const all = data.samples || [];
      const samples = event_type ? all.filter((s) => s.event === event_type) : all;
      const label = event_type ? `${event_type} events` : 'Search events';
      // `count` — общее число событий ОБОИХ типов. Ставить его рядом с отфильтрованным
      // числом как «total» — значит склеить две разные величины; сколько всего событий
      // запрошенного типа, без обхода всех страниц узнать нельзя.
      const filtered = event_type
        ? ` (of ${all.length} on this page; ${data.count ?? 'n/a'} events of both types in total)`
        : `, ${data.count ?? 'n/a'} in total`;
      // Причина исключения (`excluded_url_status`) есть ТОЛЬКО здесь: отдельной ручки
      // «исключённые страницы» в API v4 нет. Без этой сводки она молча оставалась в
      // structuredContent и в текст ответа не попадала.
      const exclusionReasons = countExclusionReasons(samples);
      // Сводка отвечает «каких причин сколько», список — «какая страница по какой причине».
      // Без второго агрегат остаётся числом, из которого нечего чинить.
      const excludedPages = selectExcludedPages(samples);
      return {
        content: [
          {
            type: 'text',
            text:
              `${label}: ${samples.length} sample URLs${filtered}.` +
              `${formatExclusionReasons(exclusionReasons)}${formatExcludedPages(excludedPages)}`,
          },
        ],
        structuredContent: {
          ...omitKey(data, 'count'),
          samples,
          exclusion_reasons: exclusionReasons,
          excluded_pages: excludedPages,
          unfiltered_total_count: data.count,
          unfiltered_page_count: all.length,
        },
      };
    },
  );

  // get-excluded-pages
  //
  // Отдельного ресурса «исключённые страницы» в API v4 НЕТ (проверено по справочнику
  // ресурсов 2026-09-02). Причина по конкретному URL живёт только в
  // `/search-urls/events/samples`, и фильтра по типу события у него нет: `limit`/`offset`
  // листают СМЕШАННЫЙ поток появившихся и исключённых, `count` считает события обоих типов.
  // Поэтому «дай 20 исключённых» — это обход страниц с накоплением, а не один вызов.
  server.tool(
    'get-excluded-pages',
    'List pages EXCLUDED from Yandex search with the reason for each one (url + excluded_url_status, ' +
      'plus bad_http_status for HTTP_ERROR and target_url for redirect/canonical/duplicate cases). ' +
      'API v4 has no "excluded pages" resource and no server-side event filter, so this walks ' +
      '/search-urls/events/samples page by page until it has collected `limit` excluded pages ' +
      '(at most `max_requests` HTTP calls) and reports next_offset/exhausted so the walk can continue. ' +
      'get-summary only carries the aggregate excluded_pages_count — a number with no reasons.',
    {
      host_id: z.string().describe('Host ID'),
      limit: z.number().min(1).max(100).optional().describe('How many EXCLUDED pages to collect (default: 20)'),
      offset: z.number().min(0).optional().describe('Event-stream offset to resume from (default: 0)'),
      max_requests: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Cap on API calls made while walking the mixed event stream (default: 10)'),
    },
    async ({ host_id, limit = 20, offset = 0, max_requests = 10 }) => {
      const endpoint = await hostUrl(host_id, '/search-urls/events/samples');
      const result = await collectExcludedPages({
        fetchPage: (pageOffset, pageSize) => apiRequest(endpoint, paginationParams(pageSize, pageOffset)),
        limit,
        offset,
        maxRequests: max_requests,
        pageSize: EVENTS_SAMPLES_PAGE_SIZE,
      });
      // «Дошли до конца потока» и «упёрлись в потолок запросов» — разные вещи: во втором
      // случае исключённые страницы ещё есть, просто мы за ними не пошли.
      const tail = result.exhausted
        ? ' Event stream exhausted.'
        : ` More may remain: resume with offset=${result.next_offset}.`;
      return {
        content: [
          {
            type: 'text',
            text:
              `Excluded pages: ${result.pages.length} (scanned ${result.scanned_events} events of both types ` +
              `in ${result.requests} API calls).${tail}${formatExcludedPages(result.pages)}`,
          },
        ],
        structuredContent: result,
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
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/links/external/history'), dates);
      return {
        content: [{ type: 'text', text: formatSeries('External links history', data) }],
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
      const data = await apiRequest(
        await hostUrl(host_id, '/links/internal/broken/samples'),
        paginationParams(limit, offset),
      );
      const links = data.links || [];
      return {
        content: [
          { type: 'text', text: `Broken internal links: ${links.length} samples (${data.count ?? 'n/a'} total).` },
        ],
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
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/links/internal/broken/history'), dates);
      return {
        content: [{ type: 'text', text: formatSeries('Broken internal links history', data) }],
        structuredContent: data,
      };
    },
  );

  // === Sitemaps (4 tools) ===

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

  // add-sitemap
  //
  // POST /user/{user-id}/hosts/{host-id}/user-added-sitemaps, тело {"url": …} →
  // {"sitemap_id": …}, 201 CREATED (справочник: «Добавление файла Sitemap»).
  // Аддитивная операция: отменяется удалением файла в Вебмастере, подтверждения
  // не требует — иначе `confirm: true` станет рефлексом и перестанет защищать
  // delete-host, единственную необратимую операцию пакета.
  registerAdditiveWriteTool(
    'add-sitemap',
    {
      title: 'Add Sitemap file',
      description:
        'Add a Sitemap file to Yandex Webmaster (user-added sitemaps). Returns sitemap_id. ' +
        'The host must be verified, or the call fails with 404 HOST_NOT_VERIFIED. Adding a file ' +
        'that is already there fails with 409 SITEMAP_ALREADY_ADDED — not a broken call but ' +
        '"already present", and the error payload names the existing sitemap_id.',
      inputSchema: {
        host_id: z.string().describe('Host ID (URL-encoded, e.g. "https:example.com:443")'),
        url: z.string().describe('Full URL of the sitemap file (e.g. "https://example.com/sitemap.xml")'),
      },
    },
    async ({ host_id, url }) => {
      const data = await apiRequestPost(await hostUrl(host_id, '/user-added-sitemaps'), { url });
      return {
        content: [{ type: 'text', text: `Sitemap added: ${url}\nSitemap ID: ${data.sitemap_id}` }],
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
      const dates = dateParams(date_from, date_to);
      const data = await apiRequest(await hostUrl(host_id, '/important-urls/history'), {
        ...dates,
        url: targetUrl,
      });
      return {
        content: [{ type: 'text', text: formatUrlHistory(`URL history for ${targetUrl}`, data) }],
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

  // 25. add-recrawl-url
  registerAdditiveWriteTool(
    'add-recrawl-url',
    {
      title: 'Queue URL for re-crawl',
      description: 'Enqueue a URL for Yandex re-crawl. Daily quota applies (check get-recrawl-quota). Returns task_id.',
      inputSchema: {
        host_id: z.string().describe('Host ID (e.g. "https:example.com:443")'),
        url: z.string().describe('Full URL on the host to re-crawl (must start with host scheme+domain)'),
      },
    },
    async ({ host_id, url }) => {
      const data = await apiRequestPost(await hostUrl(host_id, '/recrawl/queue'), { url });
      return {
        content: [
          {
            type: 'text',
            text: `Recrawl queued: ${url}\nTask ID: ${data.task_id}\nQuota remainder: ${data.quota_remainder}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // 26. get-recrawl-queue
  server.tool(
    'get-recrawl-queue',
    'List recrawl queue for a host (URLs submitted via add-recrawl-url with their state).',
    {
      host_id: z.string().describe('Host ID (e.g. "https:example.com:443")'),
      limit: z.number().optional().describe('Max results (default 10)'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async ({ host_id, limit, offset }) => {
      const data = await apiRequest(await hostUrl(host_id, '/recrawl/queue'), paginationParams(limit, offset));
      const lines = (data.tasks || []).map(
        (t) => `${t.url} — ${t.state}${t.added_time ? ` (added ${t.added_time})` : ''}`,
      );
      return {
        content: [{ type: 'text', text: lines.join('\n') || 'Recrawl queue is empty.' }],
        structuredContent: data,
      };
    },
  );

  // 27. get-recrawl-task
  server.tool(
    'get-recrawl-task',
    'Get state of a single recrawl task by task_id (returned by add-recrawl-url).',
    {
      host_id: z.string().describe('Host ID'),
      task_id: z.string().describe('Recrawl task ID'),
    },
    async ({ host_id, task_id }) => {
      const data = await apiRequest(await hostUrl(host_id, `/recrawl/queue/${task_id}`));
      return {
        content: [
          {
            type: 'text',
            text: `${data.url || ''} — ${data.state || 'unknown'}${data.added_time ? ` (added ${data.added_time})` : ''}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // === Host Management (2 tools) ===

  // add-host
  registerAdditiveWriteTool(
    'add-host',
    {
      title: 'Add site to Webmaster',
      description:
        'Add a new site (host) to Yandex Webmaster. The host_url must include protocol (e.g. "https://example.com"). After adding, the host needs verification.',
      inputSchema: {
        host_url: z.string().describe('Site URL with protocol (e.g. "https://example.com")'),
      },
    },
    async ({ host_url }) => {
      const userId = await getUserId();
      const data = await apiRequestPost(`/user/${userId}/hosts`, { host_url });
      return {
        content: [
          {
            type: 'text',
            text: `Host added!\nHost ID: ${data.host_id}\nURL: ${data.unicode_host_url || host_url}\nVerified: ${data.verified || false}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // verify-host
  server.tool(
    'verify-host',
    'Get verification status and available verification methods for a host. Use after add-host to check what verification is needed.',
    {
      host_id: z.string().describe('Host ID (URL-encoded, e.g. "https:example.com:443")'),
    },
    async ({ host_id }) => {
      const data = await apiRequest(await hostUrl(host_id, '/verification'));
      // Ответ отдаёт verification_state ("VERIFIED"/"NONE"/…), поля `verified` в нём нет,
      // а applicable_verifiers — массив СТРОК, не объектов (проверено на боевом API 2026-07-29).
      const methods = (data.applicable_verifiers || [])
        .map((v) => (typeof v === 'string' ? v : v?.verifier_type))
        .filter(Boolean)
        .join(', ');
      return {
        content: [
          {
            type: 'text',
            text:
              `Verification state: ${data.verification_state || 'UNKNOWN'}` +
              `${data.verification_type ? ` (via ${data.verification_type})` : ''}\n` +
              `Applicable methods: ${methods || 'none'}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // delete-host
  //
  // Registered through `registerTool` rather than the `server.tool(...)` used by
  // the tools above: `tool()` is deprecated in the SDK, and this is the one tool
  // that needs annotations, which the config object carries directly.
  // `confirm` is optional in the schema on purpose — a missing confirmation must
  // come back as the explanatory refusal from `confirm.mjs`, not as a schema
  // validation error the model cannot act on.
  server.registerTool(
    'delete-host',
    {
      description:
        'Remove a host (site) from Yandex Webmaster. IRREVERSIBLE: verification, indexing and search-query history,' +
        ' sitemaps and important-URL settings are lost permanently; re-adding the site starts from scratch.' +
        ' Requires `confirm: true` — without it the tool refuses and calls nothing.',
      inputSchema: {
        host_id: z.string().describe('Host ID (URL-encoded, e.g. "https:example.com:443")'),
        confirm: z.boolean().optional().describe(CONFIRM_PARAM_DESCRIPTION),
      },
      annotations: {
        title: 'Delete Webmaster host',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    createDeleteHostHandler(async (hostId) => {
      const userId = await getUserId();
      const url = `${API_BASE}/user/${userId}/hosts/${hostId}`;
      const response = await fetchWithRetry(url, {
        method: 'DELETE',
        headers: {
          Authorization: `OAuth ${getToken()}`,
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webmaster API error (${response.status}): ${errorText.substring(0, 500)}`);
      }
      return undefined;
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('yandex-webmaster-mcp running on stdio');
}
