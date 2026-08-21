#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CONFIRM_PARAM_DESCRIPTION,
  describeIds,
  describeItems,
  destructiveAnnotations,
  requireConfirmation,
} from './confirm.mjs';
import { formatDirectError, isRetryableDirectError, isRetrySafeMethod } from './errors.mjs';
import { parseTsv } from './report.mjs';

await runServer();

async function runServer() {
  // --- Config ---

  const SANDBOX = process.env.YANDEX_DIRECT_SANDBOX === 'true';
  const API_BASE = SANDBOX ? 'https://api-sandbox.direct.yandex.com/json/v5' : 'https://api.direct.yandex.com/json/v5';
  const CLIENT_LOGIN = process.env.YANDEX_DIRECT_CLIENT_LOGIN || '';

  function getToken() {
    const token = process.env.YANDEX_DIRECT_TOKEN;
    if (!token) throw new Error('YANDEX_DIRECT_TOKEN is required. Set the environment variable with your OAuth token.');
    return token;
  }

  // --- Shared utilities ---

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function backoffDelay(attempt) {
    return Math.min(1000 * 2 ** attempt, 10000);
  }

  /** Honour Retry-After (seconds or HTTP-date), else fall back to backoff. */
  function retryAfterDelay(response, attempt) {
    const retryAfter = response.headers.get('Retry-After');
    const parsed = retryAfter
      ? Number.isFinite(Number(retryAfter))
        ? Number(retryAfter) * 1000
        : Math.max(0, new Date(retryAfter).getTime() - Date.now())
      : 0;
    return parsed > 0 ? Math.min(parsed, 30000) : backoffDelay(attempt);
  }

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
      throw new Error(`Invalid JSON from API: ${text.substring(0, 500)}`);
    }
  }

  // --- API headers ---

  function baseHeaders() {
    const headers = {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json; charset=utf-8',
      'Accept-Language': 'ru',
    };
    if (CLIENT_LOGIN) {
      headers['Client-Login'] = CLIENT_LOGIN;
    }
    return headers;
  }

  // --- API request (standard services) ---

  /**
   * One JSON-RPC call to a Direct service, owning the ENTIRE retry policy.
   *
   * It deliberately does not go through `fetchWithRetry`: nesting that inside a
   * retry loop multiplied the budgets (up to 16 physical requests for one call)
   * and, worse, kept replaying writes at the HTTP layer even once the JSON layer
   * had been taught not to. `maxAttempts` here is the total number of requests
   * that will ever leave the process.
   *
   * Retry policy, by what the failure tells us about the server's state:
   *   429            — Direct rejected the call outright, so nothing was applied.
   *                    Safe to replay even for writes.
   *   5xx / network  — ambiguous: a write may already have taken effect.
   *                    Replayed for reads only.
   *   HTTP 200 with a transient `error` body (52/1000/1001/1002) — same
   *                    ambiguity, same rule. Direct signals these with status
   *                    200, which is why a status-based retry never saw them.
   */
  async function apiRequest(service, method, params, maxAttempts = 4) {
    const url = `${API_BASE}/${service}`;
    const payload = JSON.stringify({ method, params });
    const readOnly = isRetrySafeMethod(method);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const last = attempt === maxAttempts - 1;
      let response;

      try {
        response = await fetch(url, { method: 'POST', headers: baseHeaders(), body: payload });
      } catch (err) {
        if (last || !readOnly) {
          throw new Error(`Network error calling ${service}.${method}: ${err.message}`);
        }
        await sleep(backoffDelay(attempt));
        continue;
      }

      if (response.status === 429) {
        if (last) {
          throw new Error(`Rate limited by Direct on ${service}.${method} after ${maxAttempts} attempts.`);
        }
        await sleep(retryAfterDelay(response, attempt));
        continue;
      }

      if (response.status >= 500) {
        if (last || !readOnly) {
          const text = await response.text();
          throw new Error(`Direct API error (${response.status}) on ${service}.${method}: ${text.substring(0, 500)}`);
        }
        await sleep(retryAfterDelay(response, attempt));
        continue;
      }

      const data = await safeJsonParse(response);
      if (!data.error) return data;

      const message = formatDirectError(data.error);
      if (!isRetryableDirectError(data.error.error_code) || !readOnly) throw new Error(message);
      if (last) throw new Error(`${message} (after ${maxAttempts} attempts)`);

      await sleep(backoffDelay(attempt));
    }
  }

  // --- Reports API request ---

  async function reportsRequest(reportParams) {
    const url = `${API_BASE}/reports`;
    const headers = {
      ...baseHeaders(),
      // Pin the response language so the payload does not vary with the
      // account's interface locale. The parser is structural and never matches
      // on text, but a deterministic response keeps error strings readable too.
      'Accept-Language': 'en',
      processingMode: 'auto',
      returnMoneyInMicros: 'false',
      skipReportHeader: 'true',
      // Suppresses the "Total"/"Итого" row at the source — the only
      // language-independent way to be rid of it.
      skipReportSummary: 'true',
    };

    const body = { params: reportParams };
    const maxAttempts = 10;
    const timeoutMs = 120000;
    const startTime = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Report generation timed out after 120 seconds.');
      }

      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (response.status === 200) {
        // Report is ready
        const tsv = await response.text();
        return parseTsv(tsv);
      }

      if (response.status === 201 || response.status === 202) {
        // Report is still building
        const retryIn = parseInt(response.headers.get('retryIn') || '5', 10);
        const delay = Math.max(retryIn, 2) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Error
      const text = await response.text();
      throw new Error(`Reports API error (${response.status}): ${text.substring(0, 500)}`);
    }

    throw new Error('Report generation failed: max polling attempts exceeded.');
  }

  // --- Factory helpers ---

  /**
   * Register a "get" tool for a standard Direct service.
   * Creates a tool that calls `service.get` with SelectionCriteria, FieldNames, and Page.
   */
  function registerGetTool(server, toolName, service, description, filterFields) {
    const schema = {
      field_names: z
        .array(z.string())
        .describe('Fields to return (FieldNames). See tool description for common values.'),
    };

    // Add filter fields
    for (const [fieldName, fieldDesc] of Object.entries(filterFields)) {
      if (fieldName === 'Ids' || fieldName === 'KeywordIds') {
        schema[fieldName] = z.array(z.number()).optional().describe(fieldDesc);
      } else if (
        fieldName === 'CampaignIds' ||
        fieldName === 'AdGroupIds' ||
        fieldName === 'AdGroupId' ||
        fieldName === 'Types' ||
        fieldName === 'States' ||
        fieldName === 'Statuses' ||
        fieldName === 'Levels'
      ) {
        schema[fieldName] = z.array(z.string()).optional().describe(fieldDesc);
      } else {
        schema[fieldName] = z.array(z.string()).optional().describe(fieldDesc);
      }
    }

    schema.limit = z.number().min(1).max(10000).optional().describe('Page limit (default 100, max 10000)');
    schema.offset = z.number().min(0).optional().describe('Page offset (default 0)');

    server.tool(toolName, description, schema, async (params) => {
      const selectionCriteria = {};
      for (const fieldName of Object.keys(filterFields)) {
        if (params[fieldName] && params[fieldName].length > 0) {
          selectionCriteria[fieldName] = params[fieldName];
        }
      }

      const apiParams = {
        SelectionCriteria: selectionCriteria,
        FieldNames: params.field_names,
        Page: {
          Limit: params.limit || 100,
          Offset: params.offset || 0,
        },
      };

      const data = await apiRequest(service, 'get', apiParams);
      const resultKey = Object.keys(data.result || {})[0];
      const items = resultKey ? data.result[resultKey] : [];
      const count = Array.isArray(items) ? items.length : 0;
      const limited = data.result?.LimitedBy;

      let summary = `${toolName}: ${count} items returned.`;
      if (limited !== undefined) {
        summary += ` (LimitedBy: ${limited} — more items available)`;
      }

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: data.result,
      };
    });
  }

  /**
   * Register an action tool (suspend, resume, archive, unarchive, moderate).
   * Accepts an array of IDs and calls `service.{method}`.
   *
   * Every action registered this way has an inverse in this same server
   * (suspend↔resume, archive↔unarchive), or leaves the entity itself untouched
   * (moderate), so none of them needs confirmation. Deletion goes through
   * {@link registerDeleteTool} instead.
   */
  function registerActionTool(server, toolName, service, method, description) {
    server.tool(
      toolName,
      description,
      {
        ids: z.array(z.number()).describe('Array of entity IDs to act on'),
      },
      async ({ ids }) => runAction(toolName, service, method, ids),
    );
  }

  /** Shared body of the ID-list action tools, guarded and unguarded alike. */
  async function runAction(toolName, service, method, ids) {
    const data = await apiRequest(service, method, {
      SelectionCriteria: { Ids: ids },
    });

    const resultKey = Object.keys(data.result || {})[0];
    const items = resultKey ? data.result[resultKey] : [];
    const count = Array.isArray(items) ? items.length : 0;

    return {
      content: [{ type: 'text', text: `${toolName}: ${method} applied to ${count} items.` }],
      structuredContent: data.result,
    };
  }

  /**
   * Register a deletion tool: same ID-list shape as {@link registerActionTool},
   * plus the confirmation an irreversible call has to have.
   *
   * `confirm` is optional in the schema on purpose — a missing confirmation must
   * come back as the explanatory refusal from `confirm.mjs`, not as a schema
   * validation error the model cannot act on. Registered through `registerTool`
   * because the annotations live in its config object and because the
   * `server.tool(...)` overload is deprecated in the SDK.
   */
  function registerDeleteTool(server, toolName, service, description, { entity, inspect, title }) {
    server.registerTool(
      toolName,
      {
        description:
          `${description} IRREVERSIBLE: ${entity} and the statistics attached to them are lost permanently —` +
          ' re-adding creates new entities with new IDs, not the old ones back.' +
          ' Requires `confirm: true` — without it the tool refuses and calls nothing.',
        inputSchema: {
          ids: z.array(z.number()).describe('Array of entity IDs to delete'),
          confirm: z.boolean().optional().describe(CONFIRM_PARAM_DESCRIPTION),
        },
        annotations: destructiveAnnotations(title),
      },
      requireConfirmation(
        {
          tool: toolName,
          target: ({ ids }) => describeIds(ids),
          consequence:
            `Deleting ${entity} is irreversible: they and their accumulated statistics are gone for good,` +
            ' and Yandex Direct offers no way to restore them.',
          repeat: 'the same ids',
          inspect,
        },
        ({ ids }) => runAction(toolName, service, 'delete', ids),
      ),
    );
  }

  /**
   * Register an "add" tool. Accepts a JSON string of items to add.
   */
  function registerAddTool(server, toolName, service, description, itemsKey, itemsDesc) {
    server.tool(
      toolName,
      description,
      {
        items_json: z.string().describe(itemsDesc),
      },
      async ({ items_json }) => {
        let items;
        try {
          items = JSON.parse(items_json);
        } catch (e) {
          throw new Error(`Invalid JSON in items_json: ${e.message}`);
        }
        if (!Array.isArray(items)) {
          throw new Error('items_json must be a JSON array.');
        }

        const data = await apiRequest(service, 'add', {
          [itemsKey]: items,
        });

        const addResults = data.result?.AddResults || [];
        const ok = addResults.filter((r) => r.Id).length;
        const errors = addResults.filter((r) => r.Errors || r.Warnings);

        let summary = `${toolName}: ${ok} items added successfully.`;
        if (errors.length > 0) {
          const errMsgs = errors
            .map((r) => {
              const errs = (r.Errors || []).map((e) => `Error ${e.Code}: ${e.Message}`);
              const warns = (r.Warnings || []).map((w) => `Warning ${w.Code}: ${w.Message}`);
              return [...errs, ...warns].join('; ');
            })
            .join(' | ');
          summary += ` Errors/Warnings: ${errMsgs}`;
        }

        return {
          content: [{ type: 'text', text: summary }],
          structuredContent: data.result,
        };
      },
    );
  }

  /**
   * Register an "update" tool. Accepts a JSON string of items to update.
   *
   * Always guarded by confirmation: an update overwrites fields in place, and
   * Direct exposes no revision history, so the previous ad text, budget or
   * strategy is unrecoverable the moment the call succeeds. That is a loss, not
   * a reversible change, even though nothing is "deleted".
   */
  function registerUpdateTool(server, toolName, service, description, itemsKey, itemsDesc, { entity, inspect, title }) {
    server.registerTool(
      toolName,
      {
        description:
          `${description} IRREVERSIBLE: the previous values of the updated ${entity} are overwritten and cannot be` +
          ' read back from the API afterwards. Requires `confirm: true` — without it the tool refuses and calls nothing.',
        inputSchema: {
          items_json: z.string().describe(itemsDesc),
          confirm: z.boolean().optional().describe(CONFIRM_PARAM_DESCRIPTION),
        },
        annotations: destructiveAnnotations(title),
      },
      requireConfirmation(
        {
          tool: toolName,
          target: ({ items_json }) => describeItems(items_json),
          consequence:
            `Updating ${entity} overwrites their current values in place; Direct keeps no revision history,` +
            ' so the previous values cannot be recovered through this API.',
          repeat: 'the same items_json',
          inspect,
        },
        async ({ items_json }) => {
          let items;
          try {
            items = JSON.parse(items_json);
          } catch (e) {
            throw new Error(`Invalid JSON in items_json: ${e.message}`);
          }
          if (!Array.isArray(items)) {
            throw new Error('items_json must be a JSON array.');
          }

          const data = await apiRequest(service, 'update', {
            [itemsKey]: items,
          });

          const updateResults = data.result?.UpdateResults || [];
          const ok = updateResults.filter((r) => r.Id).length;
          const errors = updateResults.filter((r) => r.Errors || r.Warnings);

          let summary = `${toolName}: ${ok} items updated successfully.`;
          if (errors.length > 0) {
            const errMsgs = errors
              .map((r) => {
                const errs = (r.Errors || []).map((e) => `Error ${e.Code}: ${e.Message}`);
                const warns = (r.Warnings || []).map((w) => `Warning ${w.Code}: ${w.Message}`);
                return [...errs, ...warns].join('; ');
              })
              .join(' | ');
            summary += ` Errors/Warnings: ${errMsgs}`;
          }

          return {
            content: [{ type: 'text', text: summary }],
            structuredContent: data.result,
          };
        },
      ),
    );
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-direct-mcp', version: '2.2.0' });

  // ===========================
  // Campaigns (8 tools)
  // ===========================

  registerGetTool(
    server,
    'get_campaigns',
    'campaigns',
    'Get campaigns. Common FieldNames: Id, Name, Status, State, Type, StartDate, EndDate, DailyBudget, Statistics, ClientInfo, TimeTargeting, NegativeKeywords, BlockedIps, StatusPayment, StatusClarification, SourceId, Currency, Funds, RepresentedBy.',
    {
      Ids: 'Filter by campaign IDs',
      States: 'Filter by states: CONVERTED, ENDED, OFF, ON, SUSPENDED, ARCHIVED',
      Statuses: 'Filter by statuses: ACCEPTED, DRAFT, MODERATION, REJECTED',
      Types:
        'Filter by types: TEXT_CAMPAIGN, DYNAMIC_TEXT_CAMPAIGN, MOBILE_APP_CAMPAIGN, CPM_BANNER_CAMPAIGN, SMART_CAMPAIGN, UNIFIED_CAMPAIGN',
    },
  );

  registerAddTool(
    server,
    'add_campaigns',
    'campaigns',
    'Add new campaigns. Pass a JSON array of campaign objects. Each must include Name and a campaign-type-specific settings object (e.g. TextCampaign, DynamicTextCampaign).',
    'Campaigns',
    'JSON array of campaign objects, e.g. [{"Name":"My Campaign","StartDate":"2024-01-01","TextCampaign":{"BiddingStrategy":{"Search":{"BiddingStrategyType":"WB_MAXIMUM_CLICKS","WbMaximumClicks":{"WeeklySpendLimit":300000000}},"Network":{"BiddingStrategyType":"SERVING_OFF"}}}}]',
  );

  registerUpdateTool(
    server,
    'update_campaigns',
    'campaigns',
    'Update existing campaigns. Pass a JSON array of campaign objects with Id and fields to update.',
    'Campaigns',
    'JSON array of campaign objects with Id, e.g. [{"Id":12345,"Name":"Updated Name"}]',
    { entity: 'campaigns', inspect: 'get_campaigns', title: 'Update Direct campaigns' },
  );

  registerDeleteTool(server, 'delete_campaigns', 'campaigns', 'Delete campaigns by IDs.', {
    entity: 'campaigns',
    inspect: 'get_campaigns',
    title: 'Delete Direct campaigns',
  });
  registerActionTool(server, 'archive_campaigns', 'campaigns', 'archive', 'Archive campaigns by IDs.');
  registerActionTool(server, 'unarchive_campaigns', 'campaigns', 'unarchive', 'Unarchive campaigns by IDs.');
  registerActionTool(server, 'suspend_campaigns', 'campaigns', 'suspend', 'Suspend (pause) campaigns by IDs.');
  registerActionTool(server, 'resume_campaigns', 'campaigns', 'resume', 'Resume campaigns by IDs.');

  // ===========================
  // AdGroups (6 tools)
  // ===========================

  registerGetTool(
    server,
    'get_adgroups',
    'adgroups',
    'Get ad groups. Common FieldNames: Id, Name, CampaignId, Status, Type, RegionIds, NegativeKeywords, TrackingParams, ServingStatuses, Subtype.',
    {
      Ids: 'Filter by ad group IDs',
      CampaignIds: 'Filter by campaign IDs',
    },
  );

  registerAddTool(
    server,
    'add_adgroups',
    'adgroups',
    'Add new ad groups. Each must include Name, CampaignId, RegionIds, and optionally type-specific settings.',
    'AdGroups',
    'JSON array of ad group objects, e.g. [{"Name":"My Group","CampaignId":12345,"RegionIds":[225]}]',
  );

  registerUpdateTool(
    server,
    'update_adgroups',
    'adgroups',
    'Update existing ad groups. Pass a JSON array with Id and fields to update.',
    'AdGroups',
    'JSON array of ad group objects with Id, e.g. [{"Id":67890,"Name":"Updated Group"}]',
    { entity: 'ad groups', inspect: 'get_adgroups', title: 'Update Direct ad groups' },
  );

  registerDeleteTool(server, 'delete_adgroups', 'adgroups', 'Delete ad groups by IDs.', {
    entity: 'ad groups',
    inspect: 'get_adgroups',
    title: 'Delete Direct ad groups',
  });
  registerActionTool(server, 'archive_adgroups', 'adgroups', 'archive', 'Archive ad groups by IDs.');
  registerActionTool(server, 'unarchive_adgroups', 'adgroups', 'unarchive', 'Unarchive ad groups by IDs.');

  // ===========================
  // Ads (7 tools)
  // ===========================

  registerGetTool(
    server,
    'get_ads',
    'ads',
    'Get ads. Common FieldNames: Id, AdGroupId, CampaignId, Status, State, Type, StatusClarification, TextAd, DynamicTextAd, MobileAppAd, CpmBannerAdBuilderAd, SmartAdBuilderAd. Use TextAd field to get ad texts.',
    {
      Ids: 'Filter by ad IDs',
      AdGroupIds: 'Filter by ad group IDs',
      CampaignIds: 'Filter by campaign IDs',
      States: 'Filter by states: OFF, ON, SUSPENDED, OFF_BY_MONITORING, ARCHIVED',
      Statuses: 'Filter by statuses: ACCEPTED, DRAFT, MODERATION, PREACCEPTED, REJECTED',
    },
  );

  registerAddTool(
    server,
    'add_ads',
    'ads',
    'Add new ads. Each must include AdGroupId and an ad-type-specific object (TextAd, DynamicTextAd, etc.).',
    'Ads',
    'JSON array of ad objects, e.g. [{"AdGroupId":67890,"TextAd":{"Title":"My Ad","Title2":"Subtitle","Text":"Ad body text","Href":"https://example.com","Mobile":"NO"}}]',
  );

  registerUpdateTool(
    server,
    'update_ads',
    'ads',
    'Update existing ads. Pass a JSON array with Id and fields to update.',
    'Ads',
    'JSON array of ad objects with Id, e.g. [{"Id":11111,"TextAd":{"Title":"Updated Title"}}]',
    { entity: 'ads', inspect: 'get_ads', title: 'Update Direct ads' },
  );

  registerDeleteTool(server, 'delete_ads', 'ads', 'Delete ads by IDs.', {
    entity: 'ads',
    inspect: 'get_ads',
    title: 'Delete Direct ads',
  });
  registerActionTool(server, 'archive_ads', 'ads', 'archive', 'Archive ads by IDs.');
  registerActionTool(server, 'unarchive_ads', 'ads', 'unarchive', 'Unarchive ads by IDs.');
  registerActionTool(server, 'moderate_ads', 'ads', 'moderate', 'Send ads for moderation by IDs.');

  // ===========================
  // Keywords (6 tools)
  // ===========================

  registerGetTool(
    server,
    'get_keywords',
    'keywords',
    'Get keywords. Common FieldNames: Id, Keyword, AdGroupId, CampaignId, Status, State, Bid, ContextBid, StrategyPriority, UserParam1, UserParam2, Productivity, StatisticsSearch, StatisticsNetwork.',
    {
      Ids: 'Filter by keyword IDs',
      AdGroupIds: 'Filter by ad group IDs',
      CampaignIds: 'Filter by campaign IDs',
    },
  );

  registerAddTool(
    server,
    'add_keywords',
    'keywords',
    'Add new keywords. Each must include Keyword text and AdGroupId.',
    'Keywords',
    'JSON array of keyword objects, e.g. [{"Keyword":"buy flowers","AdGroupId":67890}]',
  );

  registerUpdateTool(
    server,
    'update_keywords',
    'keywords',
    'Update existing keywords. Pass a JSON array with Id and fields to update.',
    'Keywords',
    'JSON array of keyword objects with Id, e.g. [{"Id":22222,"Keyword":"updated keyword text"}]',
    { entity: 'keywords', inspect: 'get_keywords', title: 'Update Direct keywords' },
  );

  registerDeleteTool(server, 'delete_keywords', 'keywords', 'Delete keywords by IDs.', {
    entity: 'keywords',
    inspect: 'get_keywords',
    title: 'Delete Direct keywords',
  });
  registerActionTool(server, 'suspend_keywords', 'keywords', 'suspend', 'Suspend keywords by IDs.');
  registerActionTool(server, 'resume_keywords', 'keywords', 'resume', 'Resume keywords by IDs.');

  // ===========================
  // KeywordBids (3 tools)
  // ===========================

  registerGetTool(
    server,
    'get_keyword_bids',
    'keywordbids',
    'Get keyword bids. Common FieldNames: KeywordId, AdGroupId, CampaignId, Bid, ContextBid, CurrentSearchPrice, MinSearchPrice, StrategyPriority.',
    {
      KeywordIds: 'Filter by keyword IDs',
      AdGroupIds: 'Filter by ad group IDs',
      CampaignIds: 'Filter by campaign IDs',
    },
  );

  // set keyword bids (custom)
  //
  // Guarded: a bid is what the account pays per click. The call overwrites the
  // current value with no way to read the old one back, so a mistaken bid is
  // both unrecoverable and immediately expensive.
  server.registerTool(
    'set_keyword_bids',
    {
      description:
        'Set keyword bids. Pass a JSON array of bid objects with KeywordId, SearchBid (in micros), and/or NetworkBid (in micros).' +
        ' SPENDS MONEY and is IRREVERSIBLE: bids decide the cost per click, the previous bid is overwritten and cannot be' +
        ' read back from the API. Requires `confirm: true` — without it the tool refuses and calls nothing.',
      inputSchema: {
        bids_json: z
          .string()
          .describe('JSON array of bid objects, e.g. [{"KeywordId":12345,"SearchBid":30000000,"NetworkBid":10000000}]'),
        confirm: z.boolean().optional().describe(CONFIRM_PARAM_DESCRIPTION),
      },
      annotations: destructiveAnnotations('Set Direct keyword bids'),
    },
    requireConfirmation(
      {
        tool: 'set_keyword_bids',
        target: ({ bids_json }) => describeItems(bids_json),
        consequence:
          'Bids decide what the account pays per click, so this spends real money. The previous bids are overwritten' +
          ' in place and Direct offers no way to read them back afterwards.',
        repeat: 'the same bids_json',
        inspect: 'get_keyword_bids',
      },
      async ({ bids_json }) => {
        let bids;
        try {
          bids = JSON.parse(bids_json);
        } catch (e) {
          throw new Error(`Invalid JSON in bids_json: ${e.message}`);
        }
        if (!Array.isArray(bids)) {
          throw new Error('bids_json must be a JSON array.');
        }

        const data = await apiRequest('keywordbids', 'set', { KeywordBids: bids });
        const results = data.result?.SetResults || [];
        const ok = results.filter((r) => r.KeywordId).length;

        return {
          content: [{ type: 'text', text: `set_keyword_bids: ${ok} bids set.` }],
          structuredContent: data.result,
        };
      },
    ),
  );

  // set auto keyword bids (custom)
  server.registerTool(
    'set_auto_keyword_bids',
    {
      description:
        'Set automatic keyword bids (strategy-level). Pass a JSON array of auto-bid objects. Common fields: CampaignId, AdGroupId, KeywordId, Bid, ContextBid, and strategy parameters.' +
        ' SPENDS MONEY and is IRREVERSIBLE: these settings drive automatic bidding, the previous settings are overwritten' +
        ' and cannot be read back from the API. Requires `confirm: true` — without it the tool refuses and calls nothing.',
      inputSchema: {
        bids_json: z
          .string()
          .describe(
            'JSON array of auto-bid setting objects, e.g. [{"CampaignId":123,"AdGroupId":456,"MaxBid":50000000}]',
          ),
        confirm: z.boolean().optional().describe(CONFIRM_PARAM_DESCRIPTION),
      },
      annotations: destructiveAnnotations('Set Direct automatic keyword bids'),
    },
    requireConfirmation(
      {
        tool: 'set_auto_keyword_bids',
        target: ({ bids_json }) => describeItems(bids_json),
        consequence:
          'Automatic bidding settings decide what the account pays per click, so this spends real money.' +
          ' The previous settings are overwritten in place and Direct offers no way to read them back afterwards.',
        repeat: 'the same bids_json',
        inspect: 'get_keyword_bids',
      },
      async ({ bids_json }) => {
        let bids;
        try {
          bids = JSON.parse(bids_json);
        } catch (e) {
          throw new Error(`Invalid JSON in bids_json: ${e.message}`);
        }
        if (!Array.isArray(bids)) {
          throw new Error('bids_json must be a JSON array.');
        }

        const data = await apiRequest('keywordbids', 'setAuto', { KeywordBids: bids });
        const results = data.result?.SetAutoResults || [];
        const ok = results.filter((r) => r.KeywordId || r.AdGroupId || r.CampaignId).length;

        return {
          content: [{ type: 'text', text: `set_auto_keyword_bids: ${ok} auto bids set.` }],
          structuredContent: data.result,
        };
      },
    ),
  );

  // ===========================
  // BidModifiers (4 tools)
  // ===========================

  registerGetTool(
    server,
    'get_bid_modifiers',
    'bidmodifiers',
    'Get bid modifiers. Common FieldNames: Id, CampaignId, AdGroupId, Type, Level, MobileAdjustment, DesktopAdjustment, DemographicsAdjustment, RetargetingAdjustment, RegionalAdjustment, VideoAdjustment, SmartAdAdjustment, IncomeGradeAdjustment.',
    {
      Ids: 'Filter by bid modifier IDs',
      CampaignIds: 'Filter by campaign IDs',
      AdGroupIds: 'Filter by ad group IDs',
      Types:
        'Filter by types: MOBILE_ADJUSTMENT, DESKTOP_ADJUSTMENT, DEMOGRAPHICS_ADJUSTMENT, RETARGETING_ADJUSTMENT, REGIONAL_ADJUSTMENT, VIDEO_ADJUSTMENT, SMART_AD_ADJUSTMENT, INCOME_GRADE_ADJUSTMENT',
      Levels: 'Filter by levels: CAMPAIGN, AD_GROUP',
    },
  );

  registerAddTool(
    server,
    'add_bid_modifiers',
    'bidmodifiers',
    'Add bid modifiers. Each must include CampaignId or AdGroupId and an adjustment object.',
    'BidModifiers',
    'JSON array of bid modifier objects, e.g. [{"CampaignId":12345,"MobileAdjustment":{"BidModifier":50}}]',
  );

  // set bid modifiers (custom)
  server.registerTool(
    'set_bid_modifiers',
    {
      description:
        'Update bid modifier values. Pass a JSON array of objects with Id and the new adjustment value.' +
        ' SPENDS MONEY and is IRREVERSIBLE: modifiers multiply the bid actually paid, the previous values are' +
        ' overwritten and cannot be read back from the API.' +
        ' Requires `confirm: true` — without it the tool refuses and calls nothing.',
      inputSchema: {
        modifiers_json: z
          .string()
          .describe('JSON array of bid modifier update objects, e.g. [{"Id":11111,"BidModifier":120}]'),
        confirm: z.boolean().optional().describe(CONFIRM_PARAM_DESCRIPTION),
      },
      annotations: destructiveAnnotations('Set Direct bid modifiers'),
    },
    requireConfirmation(
      {
        tool: 'set_bid_modifiers',
        target: ({ modifiers_json }) => describeItems(modifiers_json),
        consequence:
          'Bid modifiers multiply the bid the account actually pays, so this spends real money.' +
          ' The previous values are overwritten in place and Direct offers no way to read them back afterwards.',
        repeat: 'the same modifiers_json',
        inspect: 'get_bid_modifiers',
      },
      async ({ modifiers_json }) => {
        let modifiers;
        try {
          modifiers = JSON.parse(modifiers_json);
        } catch (e) {
          throw new Error(`Invalid JSON in modifiers_json: ${e.message}`);
        }
        if (!Array.isArray(modifiers)) {
          throw new Error('modifiers_json must be a JSON array.');
        }

        const data = await apiRequest('bidmodifiers', 'set', { BidModifiers: modifiers });
        const results = data.result?.SetResults || [];
        const ok = results.filter((r) => r.Id).length;

        return {
          content: [{ type: 'text', text: `set_bid_modifiers: ${ok} modifiers set.` }],
          structuredContent: data.result,
        };
      },
    ),
  );

  registerDeleteTool(server, 'delete_bid_modifiers', 'bidmodifiers', 'Delete bid modifiers by IDs.', {
    entity: 'bid modifiers',
    inspect: 'get_bid_modifiers',
    title: 'Delete Direct bid modifiers',
  });

  // ===========================
  // Sitelinks (3 tools)
  // ===========================

  registerGetTool(
    server,
    'get_sitelinks',
    'sitelinks',
    'Get sitelink sets. Common FieldNames: Id, Sitelinks. Each Sitelinks contains an array of {Title, Href, Description}.',
    {
      Ids: 'Filter by sitelink set IDs',
    },
  );

  registerAddTool(
    server,
    'add_sitelinks',
    'sitelinks',
    'Add sitelink sets. Each set contains a Sitelinks array of {Title, Href, Description} objects (2-8 sitelinks per set).',
    'SitelinksSets',
    'JSON array of sitelink set objects, e.g. [{"Sitelinks":[{"Title":"About","Href":"https://example.com/about"},{"Title":"Contacts","Href":"https://example.com/contacts"}]}]',
  );

  registerDeleteTool(server, 'delete_sitelinks', 'sitelinks', 'Delete sitelink sets by IDs.', {
    entity: 'sitelink sets',
    inspect: 'get_sitelinks',
    title: 'Delete Direct sitelink sets',
  });

  // ===========================
  // VCards (3 tools)
  // ===========================

  registerGetTool(
    server,
    'get_vcards',
    'vcards',
    'Get VCards (business cards). Common FieldNames: Id, CampaignId, CompanyName, WorkTime, Phone, Street, Building, City, Country, Ogrn, InstantMessenger, ExtraMessage, ContactEmail, ContactPerson.',
    {
      Ids: 'Filter by VCard IDs',
    },
  );

  registerAddTool(
    server,
    'add_vcards',
    'vcards',
    'Add VCards. Each must include CampaignId, Country, City, CompanyName, WorkTime, and Phone.',
    'VCards',
    'JSON array of VCard objects, e.g. [{"CampaignId":12345,"Country":"Россия","City":"Москва","CompanyName":"My Company","WorkTime":"0;6;9;0;18;0","Phone":{"CountryCode":"+7","CityCode":"495","PhoneNumber":"1234567"}}]',
  );

  registerDeleteTool(server, 'delete_vcards', 'vcards', 'Delete VCards by IDs.', {
    entity: 'VCards',
    inspect: 'get_vcards',
    title: 'Delete Direct VCards',
  });

  // ===========================
  // Reports (1 tool)
  // ===========================

  server.tool(
    'create_report',
    'Create a Yandex Direct report. Supported ReportType: ACCOUNT_PERFORMANCE_REPORT, AD_PERFORMANCE_REPORT, ADGROUP_PERFORMANCE_REPORT, CAMPAIGN_PERFORMANCE_REPORT, CRITERIA_PERFORMANCE_REPORT, CUSTOM_REPORT, REACH_AND_FREQUENCY_PERFORMANCE_REPORT, SEARCH_QUERY_PERFORMANCE_REPORT. DateRangeType: TODAY, YESTERDAY, THIS_MONTH, LAST_MONTH, THIS_QUARTER, LAST_QUARTER, THIS_YEAR, LAST_YEAR, ALL_TIME, CUSTOM_DATE, LAST_3_DAYS, LAST_5_DAYS, LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, LAST_365_DAYS, AUTO. Result is returned as JSON array parsed from TSV (max 500 rows).',
    {
      report_type: z
        .enum([
          'ACCOUNT_PERFORMANCE_REPORT',
          'AD_PERFORMANCE_REPORT',
          'ADGROUP_PERFORMANCE_REPORT',
          'CAMPAIGN_PERFORMANCE_REPORT',
          'CRITERIA_PERFORMANCE_REPORT',
          'CUSTOM_REPORT',
          'REACH_AND_FREQUENCY_PERFORMANCE_REPORT',
          'SEARCH_QUERY_PERFORMANCE_REPORT',
        ])
        .describe('Report type'),
      field_names: z
        .array(z.string())
        .describe(
          'Columns to include. Common: Date, CampaignName, CampaignId, AdGroupName, AdGroupId, AdId, Impressions, Clicks, Cost, Ctr, AvgCpc, AvgImpressionPosition, AvgClickPosition, BounceRate, AvgPageviews, ConversionRate, CostPerConversion, Conversions, Device, Age, Gender, Query, Criterion, CriterionType, Slot',
        ),
      date_range_type: z
        .enum([
          'TODAY',
          'YESTERDAY',
          'THIS_MONTH',
          'LAST_MONTH',
          'THIS_QUARTER',
          'LAST_QUARTER',
          'THIS_YEAR',
          'LAST_YEAR',
          'ALL_TIME',
          'CUSTOM_DATE',
          'LAST_3_DAYS',
          'LAST_5_DAYS',
          'LAST_7_DAYS',
          'LAST_14_DAYS',
          'LAST_30_DAYS',
          'LAST_90_DAYS',
          'LAST_365_DAYS',
          'AUTO',
        ])
        .describe('Date range type. Use CUSTOM_DATE with date_from/date_to.'),
      date_from: z.string().optional().describe('Start date YYYY-MM-DD (required when date_range_type=CUSTOM_DATE)'),
      date_to: z.string().optional().describe('End date YYYY-MM-DD (required when date_range_type=CUSTOM_DATE)'),
      filter_json: z
        .string()
        .optional()
        .describe(
          'Optional filter as JSON array, e.g. [{"Field":"CampaignId","Operator":"EQUALS","Values":["12345"]}]. Operators: EQUALS, NOT_EQUALS, IN, NOT_IN, LESS_THAN, GREATER_THAN, STARTS_WITH_IGNORE_CASE, DOES_NOT_START_WITH_IGNORE_CASE, STARTS_WITH_ANY_IGNORE_CASE, DOES_NOT_START_WITH_ALL_IGNORE_CASE',
        ),
      include_vat: z.boolean().optional().describe('Include VAT in money values (default: true)'),
    },
    async ({ report_type, field_names, date_range_type, date_from, date_to, filter_json, include_vat }) => {
      // Generate unique report name
      const reportName = `mcp_report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const reportParams = {
        SelectionCriteria: {},
        FieldNames: field_names,
        ReportName: reportName,
        ReportType: report_type,
        DateRangeType: date_range_type,
        Format: 'TSV',
        IncludeVAT: include_vat === false ? 'NO' : 'YES',
        IncludeDiscount: 'NO',
      };

      if (date_range_type === 'CUSTOM_DATE') {
        if (!date_from || !date_to) {
          throw new Error('date_from and date_to are required when date_range_type is CUSTOM_DATE.');
        }
        reportParams.SelectionCriteria.DateFrom = date_from;
        reportParams.SelectionCriteria.DateTo = date_to;
      }

      if (filter_json) {
        let filters;
        try {
          filters = JSON.parse(filter_json);
        } catch (e) {
          throw new Error(`Invalid JSON in filter_json: ${e.message}`);
        }
        if (Array.isArray(filters)) {
          reportParams.SelectionCriteria.Filter = filters;
        }
      }

      const rows = await reportsRequest(reportParams);

      let summary = `Report ${report_type}: ${rows.length} rows returned.`;
      if (rows.length >= 500) {
        summary += ' (Output truncated to 500 rows)';
      }

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: { rows, total_rows: rows.length },
      };
    },
  );

  // ===========================
  // Dictionaries (1 tool)
  // ===========================

  server.tool(
    'get_dictionaries',
    'Get Yandex Direct dictionaries (reference data). Available dictionaries: Currencies, MetroStations, GeoRegions, TimeZones, Constants, Categories, OperationSystemVersions, InterestCategories, Interests, AudienceInterests.',
    {
      dictionary_names: z
        .array(
          z.enum([
            'Currencies',
            'MetroStations',
            'GeoRegions',
            'TimeZones',
            'Constants',
            'Categories',
            'OperationSystemVersions',
            'InterestCategories',
            'Interests',
            'AudienceInterests',
          ]),
        )
        .describe('Array of dictionary names to retrieve'),
    },
    async ({ dictionary_names }) => {
      const data = await apiRequest('dictionaries', 'get', {
        DictionaryNames: dictionary_names,
      });

      const result = data.result || {};
      const summaryParts = [];
      for (const name of dictionary_names) {
        const items = result[name];
        const count = Array.isArray(items) ? items.length : 0;
        summaryParts.push(`${name}: ${count} items`);
      }

      return {
        content: [{ type: 'text', text: `Dictionaries: ${summaryParts.join(', ')}` }],
        structuredContent: result,
      };
    },
  );

  // ===========================
  // Clients (1 tool)
  // ===========================

  server.tool(
    'get_clients',
    'Get client info (for agency accounts). Common FieldNames: Login, ClientId, ClientInfo, AccountQuality, Archived, CountryId, CreatedAt, Currency, Grants, Notification, OverdraftSumAvailable, Phone, Representatives, Restrictions, Settings, Type.',
    {
      field_names: z.array(z.string()).describe('Fields to return, e.g. ["Login","ClientId","ClientInfo","Currency"]'),
    },
    async ({ field_names }) => {
      const data = await apiRequest('clients', 'get', {
        FieldNames: field_names,
      });

      const clients = data.result?.Clients || [];

      return {
        content: [{ type: 'text', text: `get_clients: ${clients.length} clients returned.` }],
        structuredContent: data.result,
      };
    },
  );

  // --- Connect transport ---

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`yandex-direct-mcp running on stdio (${SANDBOX ? 'SANDBOX' : 'PRODUCTION'})`);
}
