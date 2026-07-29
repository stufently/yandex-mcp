#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EMPTY_RESULT_ERROR_CODES, parseError, parseFound, parseSearchResults } from './parse.mjs';

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

  // --- XML Helpers ---
  // Сам разбор XML живёт в ./parse.mjs — он чистый и покрыт тестами.

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

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-search', version: '2.0.0' });

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
          structuredContent: { results: [], query, page, returnedResults: 0, totalResults: 0 },
        };
      }

      let xml;
      try {
        xml = Buffer.from(data.rawData, 'base64').toString('utf-8');
      } catch {
        throw new Error('Failed to decode base64 rawData from Search API');
      }

      // Ошибка приезжает внутри XML с кодом 200 снаружи. Всё, кроме «ничего не нашлось»,
      // обязано всплыть наверх: иначе исчерпанная квота выглядит как пустая выдача.
      const apiError = parseError(xml);
      if (apiError && !EMPTY_RESULT_ERROR_CODES.has(apiError.code)) {
        throw new Error(`Search API error (XML code ${apiError.code ?? 'unknown'}): ${apiError.message}`);
      }

      const { total, human } = parseFound(xml);
      const results = parseSearchResults(xml);

      if (results.length === 0) {
        const reason = apiError ? ` ${apiError.message}` : '';
        return {
          content: [{ type: 'text', text: `No results found for "${query}".${reason}` }],
          structuredContent: { results: [], query, page, returnedResults: 0, totalResults: total ?? 0 },
        };
      }

      const summary = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.substring(0, 150)}`)
        .join('\n\n');

      const foundNote = total !== null ? ` of ${total.toLocaleString('en-US')} found${human ? ` (${human})` : ''}` : '';

      return {
        content: [{ type: 'text', text: `Showing ${results.length}${foundNote} for "${query}":\n\n${summary}` }],
        structuredContent: {
          results,
          query,
          page,
          returnedResults: results.length,
          totalResults: total ?? results.length,
          totalResultsHuman: human || null,
        },
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('yandex-search-mcp running on stdio');
}
