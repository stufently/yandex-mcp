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
  const MANAGEMENT_API = 'https://api-metrica.yandex.net/management/v1';
  const STAT_API = 'https://api-metrica.yandex.net/stat/v1';

  function getToken() {
    const token = process.env.YANDEX_METRIKA_TOKEN;
    if (!token)
      throw new Error('YANDEX_METRIKA_TOKEN is required. Run `npx yandex-metrika-mcp auth` or set it manually.');
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

  // --- Date helpers ---

  function getDefaultDates() {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { date1: from.toISOString().split('T')[0], date2: to };
  }

  // --- API requests ---

  async function managementRequest(endpoint) {
    const url = `${MANAGEMENT_API}${endpoint}`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `OAuth ${getToken()}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Metrika API error (${response.status}): ${errorText.substring(0, 500)}`);
    }
    return safeJsonParse(response);
  }

  async function managementRequestPost(endpoint, body) {
    const url = `${MANAGEMENT_API}${endpoint}`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Metrika API error (${response.status}): ${errorText.substring(0, 500)}`);
    }
    return safeJsonParse(response);
  }

  async function managementRequestDelete(endpoint) {
    const url = `${MANAGEMENT_API}${endpoint}`;
    const response = await fetchWithRetry(url, {
      method: 'DELETE',
      headers: { Authorization: `OAuth ${getToken()}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Metrika API error (${response.status}): ${errorText.substring(0, 500)}`);
    }
    if (response.headers.get('content-type')?.includes('application/json')) {
      return safeJsonParse(response);
    }
    return { success: true };
  }

  async function statRequest(params) {
    const url = new URL(`${STAT_API}/data`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: { Authorization: `OAuth ${getToken()}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Metrika Stat API error (${response.status}): ${errorText.substring(0, 500)}`);
    }
    const data = await safeJsonParse(response);

    // Format response with sampling warning
    let samplingNote = '';
    if (data.sampled) {
      samplingNote = ' (Note: data is sampled, not exact)';
    }

    return { data, samplingNote };
  }

  function formatStatRows(data) {
    const rows = data.data || [];
    if (rows.length === 0) return 'No data available.';
    return rows
      .map((row, i) => {
        const dims = (row.dimensions || []).map((d) => d.name || d.id || 'N/A').join(' > ');
        const mets = (row.metrics || []).map((m) => (typeof m === 'number' ? m.toLocaleString() : m)).join(', ');
        return `${i + 1}. ${dims}: ${mets}`;
      })
      .join('\n');
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-metrika', version: '1.0.0' });

  // === Management (5 tools) ===

  // 1. get-counters
  server.tool('get-counters', 'List all Metrika counters (sites).', {}, async () => {
    const data = await managementRequest('/counters');
    const counters = data.counters || [];
    const summary = counters.map((c) => `${c.id}: ${c.name} (${c.site}) [${c.status}]`).join('\n');
    return {
      content: [{ type: 'text', text: `${counters.length} counters:\n${summary}` }],
      structuredContent: data,
    };
  });

  // 2. get-counter
  server.tool(
    'get-counter',
    'Get details for a specific Metrika counter.',
    {
      counter_id: z.number().describe('Counter ID'),
    },
    async ({ counter_id }) => {
      const data = await managementRequest(`/counter/${counter_id}`);
      const counter = data.counter || data;
      return {
        content: [
          {
            type: 'text',
            text: `Counter ${counter_id}: ${counter.name || 'N/A'} (${counter.site || counter.site2?.domain || 'N/A'})`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // 3. get-goals
  server.tool(
    'get-goals',
    'Get goals for a Metrika counter.',
    {
      counter_id: z.number().describe('Counter ID'),
    },
    async ({ counter_id }) => {
      const data = await managementRequest(`/counter/${counter_id}/goals`);
      const goals = data.goals || [];
      const summary = goals.map((g) => `${g.id}: ${g.name} (${g.type})`).join('\n');
      return {
        content: [{ type: 'text', text: `${goals.length} goals:\n${summary}` }],
        structuredContent: data,
      };
    },
  );

  // 4. create-counter
  server.tool(
    'create-counter',
    'Create a new Metrika counter (add a site).',
    {
      name: z.string().describe('Counter name'),
      site: z.string().describe('Site domain (e.g. "example.com")'),
      mirrors: z.array(z.string()).optional().describe('Mirror domains'),
      time_zone_name: z.string().optional().describe('Timezone (e.g. "Europe/Moscow")'),
      gdpr_agreement_accepted: z.boolean().optional().describe('GDPR agreement accepted (required for EU)'),
    },
    async ({ name, site, mirrors, time_zone_name, gdpr_agreement_accepted }) => {
      const counterData = { name, site };
      if (mirrors) counterData.mirrors = mirrors;
      if (time_zone_name) counterData.time_zone_name = time_zone_name;

      const params = {};
      if (gdpr_agreement_accepted) params.gdpr_agreement_accepted = 1;

      const qs = Object.keys(params).length
        ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
        : '';

      const data = await managementRequestPost(`/counters${qs}`, { counter: counterData });
      const counter = data.counter || data;
      return {
        content: [
          {
            type: 'text',
            text: `Counter created! ID: ${counter.id}, Name: ${counter.name}, Site: ${counter.site}`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // 5. delete-counter
  server.tool(
    'delete-counter',
    'Delete a Metrika counter.',
    {
      counter_id: z.number().describe('Counter ID to delete'),
    },
    async ({ counter_id }) => {
      const data = await managementRequestDelete(`/counter/${counter_id}`);
      return {
        content: [
          {
            type: 'text',
            text: `Counter ${counter_id} deleted successfully.`,
          },
        ],
        structuredContent: data,
      };
    },
  );

  // === Reporting (6 tools) ===

  // 6. get-traffic-summary
  server.tool(
    'get-traffic-summary',
    'Get traffic summary: visits, users, pageviews, bounce rate, avg duration.',
    {
      counter_id: z.number().describe('Counter ID'),
      date_from: z.string().optional().describe('Start date YYYY-MM-DD'),
      date_to: z.string().optional().describe('End date YYYY-MM-DD'),
    },
    async ({ counter_id, date_from, date_to }) => {
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        metrics: 'ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds',
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
      });

      const totals = data.totals || [];
      const labels = ['Visits', 'Users', 'Pageviews', 'Bounce Rate', 'Avg Duration (s)'];
      const summary = labels
        .map(
          (l, i) =>
            `${l}: ${totals[i] != null ? (typeof totals[i] === 'number' ? totals[i].toLocaleString() : totals[i]) : 'N/A'}`,
        )
        .join('\n');

      return {
        content: [{ type: 'text', text: `Traffic summary${samplingNote}:\n${summary}` }],
        structuredContent: data,
      };
    },
  );

  // 7. get-traffic-sources
  server.tool(
    'get-traffic-sources',
    'Get traffic breakdown by source.',
    {
      counter_id: z.number().describe('Counter ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().min(1).optional().describe('Max results (default: 10)'),
    },
    async ({ counter_id, date_from, date_to, limit = 10 }) => {
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        dimensions: 'ym:s:trafficSource',
        metrics: 'ym:s:visits,ym:s:users,ym:s:bounceRate',
        sort: '-ym:s:visits',
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
        limit,
      });

      return {
        content: [{ type: 'text', text: `Traffic sources${samplingNote}:\n${formatStatRows(data)}` }],
        structuredContent: data,
      };
    },
  );

  // 8. get-geography
  server.tool(
    'get-geography',
    'Get traffic breakdown by country and city.',
    {
      counter_id: z.number().describe('Counter ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().min(1).optional().describe('Max results (default: 10)'),
    },
    async ({ counter_id, date_from, date_to, limit = 10 }) => {
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        dimensions: 'ym:s:regionCountry,ym:s:regionCity',
        metrics: 'ym:s:visits,ym:s:users',
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
        limit,
      });

      return {
        content: [{ type: 'text', text: `Geography${samplingNote}:\n${formatStatRows(data)}` }],
        structuredContent: data,
      };
    },
  );

  // 9. get-devices
  server.tool(
    'get-devices',
    'Get traffic breakdown by device, browser, or OS.',
    {
      counter_id: z.number().describe('Counter ID'),
      group_by: z.enum(['device', 'browser', 'os']).optional().describe('Group by (default: device)'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().min(1).optional().describe('Max results (default: 10)'),
    },
    async ({ counter_id, group_by = 'device', date_from, date_to, limit = 10 }) => {
      const dimensionMap = {
        device: 'ym:s:deviceCategory',
        browser: 'ym:s:browser',
        os: 'ym:s:operatingSystem',
      };
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        dimensions: dimensionMap[group_by],
        metrics: 'ym:s:visits,ym:s:users',
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
        limit,
      });

      return {
        content: [{ type: 'text', text: `Devices (${group_by})${samplingNote}:\n${formatStatRows(data)}` }],
        structuredContent: data,
      };
    },
  );

  // 10. get-popular-pages
  server.tool(
    'get-popular-pages',
    'Get most visited pages.',
    {
      counter_id: z.number().describe('Counter ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().min(1).optional().describe('Max results (default: 10)'),
    },
    async ({ counter_id, date_from, date_to, limit = 10 }) => {
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        dimensions: 'ym:pv:URLPath',
        metrics: 'ym:pv:pageviews,ym:pv:users',
        sort: '-ym:pv:pageviews',
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
        limit,
      });

      return {
        content: [{ type: 'text', text: `Popular pages${samplingNote}:\n${formatStatRows(data)}` }],
        structuredContent: data,
      };
    },
  );

  // 11. get-search-phrases
  server.tool(
    'get-search-phrases',
    'Get top search phrases driving traffic.',
    {
      counter_id: z.number().describe('Counter ID'),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().min(1).optional().describe('Max results (default: 20)'),
    },
    async ({ counter_id, date_from, date_to, limit = 20 }) => {
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        dimensions: 'ym:s:searchPhrase',
        metrics: 'ym:s:visits,ym:s:users',
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
        limit,
      });

      return {
        content: [{ type: 'text', text: `Search phrases${samplingNote}:\n${formatStatRows(data)}` }],
        structuredContent: data,
      };
    },
  );

  // 12. get-report (custom)
  server.tool(
    'get-report',
    'Run a custom Metrika report with arbitrary metrics and dimensions.',
    {
      counter_id: z.number().describe('Counter ID'),
      metrics: z.string().describe('Comma-separated metrics (e.g. "ym:s:visits,ym:s:users")'),
      dimensions: z.string().optional().describe('Comma-separated dimensions'),
      date_from: z.string().optional().describe('Start date YYYY-MM-DD'),
      date_to: z.string().optional().describe('End date YYYY-MM-DD'),
      filters: z.string().optional().describe('Filter expression (e.g. "ym:s:trafficSource==\'organic\'")'),
      sort: z.string().optional().describe('Sort field (prefix with - for DESC)'),
      limit: z.number().min(1).optional().describe('Max results (default: 10)'),
    },
    async ({ counter_id, metrics, dimensions, date_from, date_to, filters, sort, limit = 10 }) => {
      const defaults = getDefaultDates();
      const vFrom = validateDate(date_from);
      const vTo = validateDate(date_to);
      const { data, samplingNote } = await statRequest({
        ids: counter_id,
        metrics,
        dimensions: dimensions || undefined,
        date1: vFrom || defaults.date1,
        date2: vTo || defaults.date2,
        filters: filters || undefined,
        sort: sort || undefined,
        limit,
      });

      return {
        content: [{ type: 'text', text: `Custom report${samplingNote}:\n${formatStatRows(data)}` }],
        structuredContent: data,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('yandex-metrika-mcp running on stdio');
}
