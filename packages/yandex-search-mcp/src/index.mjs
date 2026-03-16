#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

await runServer();

async function runServer() {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!apiKey) throw new Error('YANDEX_SEARCH_API_KEY is required. Get it from https://console.yandex.cloud/');
  if (!folderId) throw new Error('YANDEX_FOLDER_ID is required. Get it from https://console.yandex.cloud/');

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

  // --- XML Helpers ---

  function cleanHtml(str) {
    if (!str) return '';
    return str
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractTag(xml, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = xml.match(re);
    return m ? m[1] : '';
  }

  function extractAllTags(xml, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const results = [];
    for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
      results.push(m[1]);
    }
    return results;
  }

  function detectLanguage(query) {
    const hasCyrillic = /[\u0400-\u04FF]/.test(query);
    return hasCyrillic ? 'ru' : 'en';
  }

  const searchTypeMap = {
    ru: 'SEARCH_TYPE_RU',
    en: 'SEARCH_TYPE_COM',
    be: 'SEARCH_TYPE_BE',
    uk: 'SEARCH_TYPE_UK',
    kk: 'SEARCH_TYPE_KK',
  };
  const l10nMap = {
    ru: 'LOCALIZATION_RU',
    en: 'LOCALIZATION_EN',
    be: 'LOCALIZATION_BE',
    uk: 'LOCALIZATION_UK',
    kk: 'LOCALIZATION_KK',
  };

  function parseSearchResults(xml) {
    const groups = extractAllTags(xml, 'group');
    if (groups.length === 0) return [];

    return groups
      .map((group, i) => {
        const doc = extractTag(group, 'doc');
        if (!doc) return null;

        const url = cleanHtml(extractTag(doc, 'url'));
        let domain = '';
        try {
          domain = new URL(url).hostname;
        } catch {}

        const title = cleanHtml(extractTag(doc, 'title'));
        const headline = cleanHtml(extractTag(doc, 'headline'));
        const passages = extractAllTags(doc, 'passage').map(cleanHtml).filter(Boolean);
        const snippet = [headline, ...passages].filter(Boolean).join(' ');

        const sizeStr = extractTag(doc, 'size');
        const size = parseInt(sizeStr, 10) || 0;
        const lang = cleanHtml(extractTag(doc, 'lang'));
        const cachedUrl = cleanHtml(extractTag(doc, 'saved-copy-url'));

        return { position: i + 1, url, domain, title, headline, passages, snippet, size, lang, cachedUrl };
      })
      .filter(Boolean);
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-search', version: '1.0.0' });

  server.tool(
    'search',
    'Search the web using Yandex Search API. Returns ranked results with titles, snippets, and URLs.',
    {
      query: z.string().describe('Search query text'),
      maxResults: z.number().min(1).max(100).optional().describe('Maximum results to return (default: 10)'),
      region: z.number().optional().describe('Yandex region ID'),
      page: z.number().min(0).optional().describe('Page number (0-based, default: 0)'),
      familyMode: z
        .enum(['FAMILY_MODE_NONE', 'FAMILY_MODE_MODERATE', 'FAMILY_MODE_STRICT'])
        .optional()
        .describe('Safe search filter'),
    },
    async ({ query, maxResults = 10, region, page = 0, familyMode = 'FAMILY_MODE_MODERATE' }) => {
      const lang = detectLanguage(query);
      const searchType = searchTypeMap[lang] || 'SEARCH_TYPE_RU';
      const l10n = l10nMap[lang] || 'LOCALIZATION_RU';

      const body = {
        query: {
          searchType,
          queryText: query,
          familyMode,
          page: String(page),
          fixTypoMode: 'FIX_TYPO_MODE_ON',
        },
        sortSpec: {
          sortMode: 'SORT_MODE_BY_RELEVANCE',
          sortOrder: 'SORT_ORDER_DESC',
        },
        groupSpec: {
          groupMode: 'GROUP_MODE_DEEP',
          groupsOnPage: String(maxResults),
          docsInGroup: '1',
        },
        folderId,
        responseFormat: 'FORMAT_XML',
        l10n,
      };
      if (region !== undefined) body.region = String(region);

      const response = await fetchWithRetry('https://searchapi.api.cloud.yandex.net/v2/web/search', {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Search API error (${response.status}): ${errText.substring(0, 500)}`);
      }

      const data = await safeJsonParse(response);

      if (!data.rawData) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}".` }],
          structuredContent: { results: [], query, page, totalResults: 0 },
        };
      }

      let xml;
      try {
        xml = Buffer.from(data.rawData, 'base64').toString('utf-8');
      } catch {
        throw new Error('Failed to decode base64 rawData from Search API');
      }

      const results = parseSearchResults(xml);

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}".` }],
          structuredContent: { results: [], query, page, totalResults: 0 },
        };
      }

      const summary = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.substring(0, 150)}`)
        .join('\n\n');

      return {
        content: [{ type: 'text', text: `Found ${results.length} results for "${query}":\n\n${summary}` }],
        structuredContent: { results, query, page, totalResults: results.length },
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('yandex-search-mcp running on stdio');
}
