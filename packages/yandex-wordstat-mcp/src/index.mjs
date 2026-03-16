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
  const API_BASE = 'https://api.wordstat.yandex.net';

  function getToken() {
    const token = process.env.YANDEX_WORDSTAT_TOKEN;
    if (!token)
      throw new Error('YANDEX_WORDSTAT_TOKEN is required. Run `npx yandex-wordstat-mcp auth` or set it manually.');
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

  // --- Rate Limiter (10 req/sec sliding window) ---

  const requestTimestamps = [];
  const MAX_RPS = 10;

  async function rateLimitedFetch(url, options) {
    const now = Date.now();
    // Remove timestamps older than 1 second
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 1000) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length >= MAX_RPS) {
      const waitTime = requestTimestamps[0] + 1000 - now;
      if (waitTime > 0) await new Promise((r) => setTimeout(r, waitTime));
    }
    requestTimestamps.push(Date.now());
    return fetchWithRetry(url, options);
  }

  // --- API Request ---

  async function apiRequest(endpoint, body = {}) {
    const url = `${API_BASE}${endpoint}`;
    const response = await rateLimitedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Wordstat API error (${response.status}): ${errorText.substring(0, 500)}`);
    }

    return safeJsonParse(response);
  }

  // --- Region Cache ---

  let regionsTree = null;
  let regionsFlat = null; // Map<regionId, {label, parentId}>

  async function getRegionsTree() {
    if (regionsTree) return regionsTree;
    const data = await apiRequest('/v1/getRegionsTree');
    regionsTree = data;
    regionsFlat = new Map();
    buildFlatMap(regionsTree, null);
    return regionsTree;
  }

  function buildFlatMap(nodes, parentId) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      regionsFlat.set(node.value, { label: node.label, parentId });
      if (node.children && node.children.length > 0) {
        buildFlatMap(node.children, node.value);
      }
    }
  }

  function getDescendantIds(regionId) {
    const ids = new Set([regionId]);
    const queue = [regionId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const [id, info] of regionsFlat.entries()) {
        if (info.parentId === current && !ids.has(id)) {
          ids.add(id);
          queue.push(id);
        }
      }
    }
    return ids;
  }

  function trimTree(nodes, maxDepth, currentDepth = 1) {
    if (!Array.isArray(nodes) || currentDepth > maxDepth) return [];
    return nodes.map((node) => ({
      value: node.value,
      label: node.label,
      children: currentDepth < maxDepth ? trimTree(node.children || [], maxDepth, currentDepth + 1) : [],
    }));
  }

  function findSubtree(nodes, regionId) {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (node.value === regionId) return node;
      const found = findSubtree(node.children || [], regionId);
      if (found) return found;
    }
    return null;
  }

  // --- Date helpers ---

  function formatDate(d) {
    return d.toISOString().split('T')[0];
  }

  function getDefaultDates(period) {
    const now = new Date();
    if (period === 'daily') {
      const from = new Date(now);
      from.setDate(from.getDate() - 60);
      const to = new Date(now);
      to.setDate(to.getDate() - 1);
      return { fromDate: formatDate(from), toDate: formatDate(to) };
    }
    if (period === 'weekly') {
      // From Monday ~1 year ago to last Sunday
      const to = new Date(now);
      to.setDate(to.getDate() - ((to.getDay() + 6) % 7) - 1); // last Sunday
      const from = new Date(to);
      from.setFullYear(from.getFullYear() - 1);
      // Adjust to Monday
      const dayOfWeek = from.getDay();
      const diff = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
      from.setDate(from.getDate() + diff);
      return { fromDate: formatDate(from), toDate: formatDate(to) };
    }
    // monthly
    const to = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
    const from = new Date(to);
    from.setFullYear(from.getFullYear() - 1);
    from.setDate(1);
    return { fromDate: formatDate(from), toDate: formatDate(to) };
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-wordstat', version: '1.0.0' });

  // Tool 1: get-regions-tree
  server.tool(
    'get-regions-tree',
    'Get the Yandex Wordstat regions hierarchy tree. Free (0 quota units).',
    {
      depth: z.number().min(1).max(5).optional().describe('Maximum tree depth (default: 3)'),
    },
    async ({ depth = 3 }) => {
      const tree = await getRegionsTree();
      const trimmed = trimTree(tree, depth);
      return {
        content: [{ type: 'text', text: `Regions tree (depth ${depth}), ${regionsFlat.size} total regions.` }],
        structuredContent: { regions: trimmed, totalRegions: regionsFlat.size },
      };
    },
  );

  // Tool 2: get-region-children
  server.tool(
    'get-region-children',
    'Get children of a specific region from cached tree. Free (0 quota units).',
    {
      regionId: z.number().describe('Region ID to get children for'),
      depth: z.number().min(1).max(3).optional().describe('Maximum subtree depth (default: 2)'),
    },
    async ({ regionId, depth = 2 }) => {
      const tree = await getRegionsTree();
      const subtree = findSubtree(tree, regionId);
      if (!subtree) {
        return {
          content: [{ type: 'text', text: `Region ${regionId} not found.` }],
          structuredContent: { error: 'Region not found', regionId },
        };
      }
      const trimmed = trimTree(subtree.children || [], depth);
      const regionName = regionsFlat.get(regionId)?.label || 'Unknown';
      return {
        content: [
          {
            type: 'text',
            text: `Children of "${regionName}" (${regionId}), depth ${depth}: ${trimmed.length} direct children.`,
          },
        ],
        structuredContent: { regionId, regionName, children: trimmed },
      };
    },
  );

  // Tool 3: top-requests
  server.tool(
    'top-requests',
    'Find popular search queries containing a keyword. Costs 1 quota unit.',
    {
      phrase: z.string().describe('Keyword or phrase to search for'),
      regions: z.array(z.number()).optional().describe('Region IDs to filter by'),
      devices: z
        .array(z.enum(['desktop', 'phone', 'tablet']))
        .optional()
        .describe('Device types to filter by'),
    },
    async ({ phrase, regions, devices }) => {
      const body = { phrase };
      if (regions) body.regions = regions;
      if (devices) body.devices = devices;

      const data = await apiRequest('/v1/topRequests', body);
      const topRequests = data.topRequests || [];

      const summary =
        topRequests.length > 0
          ? topRequests
              .slice(0, 20)
              .map((r, i) => `${i + 1}. "${r.phrase}" — ${r.count.toLocaleString()} searches`)
              .join('\n')
          : `No popular queries found for "${phrase}".`;

      return {
        content: [{ type: 'text', text: `Top queries for "${phrase}" (${topRequests.length} results):\n\n${summary}` }],
        structuredContent: data,
      };
    },
  );

  // Tool 4: dynamics
  server.tool(
    'dynamics',
    'Analyze search volume trends over time for a keyword. Costs 2 quota units.',
    {
      phrase: z.string().describe('Keyword or phrase'),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Aggregation period (default: monthly)'),
      fromDate: z.string().optional().describe('Start date YYYY-MM-DD'),
      toDate: z.string().optional().describe('End date YYYY-MM-DD'),
      regions: z.array(z.number()).optional().describe('Region IDs'),
      devices: z
        .array(z.enum(['desktop', 'phone', 'tablet']))
        .optional()
        .describe('Device types'),
    },
    async ({ phrase, period = 'monthly', fromDate, toDate, regions, devices }) => {
      const validFrom = validateDate(fromDate);
      const validTo = validateDate(toDate);

      const defaults = getDefaultDates(period);
      const body = {
        phrase,
        period,
        fromDate: validFrom || defaults.fromDate,
        toDate: validTo || defaults.toDate,
      };
      if (regions) body.regions = regions;
      if (devices) body.devices = devices;

      const data = await apiRequest('/v1/dynamics', body);
      const dynamics = data.dynamics || [];

      let trend = '';
      if (dynamics.length >= 2) {
        const first = dynamics[0]?.count || 0;
        const last = dynamics[dynamics.length - 1]?.count || 0;
        const change = first > 0 ? (((last - first) / first) * 100).toFixed(1) : 0;
        trend = ` | Trend: ${change > 0 ? '+' : ''}${change}%`;
      }

      const summary =
        dynamics.length > 0
          ? `"${phrase}" dynamics (${period}, ${body.fromDate} → ${body.toDate})${trend}\n\n` +
            dynamics
              .slice(0, 24)
              .map((d) => `${d.date}: ${d.count.toLocaleString()}`)
              .join('\n')
          : `No dynamics data for "${phrase}".`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: { ...data, period, fromDate: body.fromDate, toDate: body.toDate },
      };
    },
  );

  // Tool 5: regions
  server.tool(
    'regions',
    'Get regional distribution of search interest for a keyword. Costs 2 quota units.',
    {
      phrase: z.string().describe('Keyword or phrase'),
      regions: z.array(z.number()).optional().describe('Region IDs to filter (client-side)'),
      devices: z
        .array(z.enum(['desktop', 'phone', 'tablet']))
        .optional()
        .describe('Device types'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default: 20)'),
    },
    async ({ phrase, regions: filterRegions, devices, limit = 20 }) => {
      const body = { phrase };
      if (devices) body.devices = devices;

      // Ensure regions tree is loaded for enrichment
      await getRegionsTree();

      const data = await apiRequest('/v1/regions', body);
      let regionResults = data.regions || [];

      // Client-side filtering by region IDs + descendants
      if (filterRegions && filterRegions.length > 0) {
        const allowedIds = new Set();
        for (const rId of filterRegions) {
          for (const id of getDescendantIds(rId)) {
            allowedIds.add(id);
          }
        }
        regionResults = regionResults.filter((r) => allowedIds.has(r.regionId));
      }

      // Enrich with region names
      regionResults = regionResults.map((r) => ({
        ...r,
        regionName: regionsFlat.get(r.regionId)?.label || `Region ${r.regionId}`,
      }));

      // Sort by count desc and limit
      regionResults.sort((a, b) => (b.count || 0) - (a.count || 0));
      regionResults = regionResults.slice(0, limit);

      const summary =
        regionResults.length > 0
          ? regionResults
              .map(
                (r, i) =>
                  `${i + 1}. ${r.regionName} — ${(r.count || 0).toLocaleString()} (affinity: ${r.affinityIndex || 'N/A'})`,
              )
              .join('\n')
          : `No regional data for "${phrase}".`;

      return {
        content: [
          { type: 'text', text: `Regional interest for "${phrase}" (${regionResults.length} regions):\n\n${summary}` },
        ],
        structuredContent: { phrase, regions: regionResults },
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('yandex-wordstat-mcp running on stdio');
}
