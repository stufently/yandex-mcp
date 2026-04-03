#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

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

  async function apiRequest(service, method, params) {
    const url = `${API_BASE}/${service}`;
    const body = { method, params };

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(body),
    });

    const data = await safeJsonParse(response);

    if (data.error) {
      const e = data.error;
      const retryable = ['52', '1000', '1001', '1002'];
      if (retryable.includes(String(e.error_code))) {
        // Already handled by fetchWithRetry for HTTP-level errors,
        // but Direct may return 200 with error body for transient issues.
        throw new Error(
          `Yandex Direct API error ${e.error_code}: ${e.error_string}. ${e.error_detail || ''} (request_id: ${e.request_id || 'N/A'})`,
        );
      }
      throw new Error(
        `Yandex Direct API error ${e.error_code}: ${e.error_string}. ${e.error_detail || ''} (request_id: ${e.request_id || 'N/A'})`,
      );
    }

    return data;
  }

  // --- Reports API request ---

  async function reportsRequest(reportParams) {
    const url = `${API_BASE}/reports`;
    const headers = {
      ...baseHeaders(),
      processingMode: 'auto',
      returnMoneyInMicros: 'false',
      skipReportHeader: 'true',
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

  function parseTsv(tsv) {
    // Strip BOM
    if (tsv.charCodeAt(0) === 0xfeff) {
      tsv = tsv.slice(1);
    }

    const lines = tsv.split('\n').filter((line) => {
      if (!line.trim()) return false;
      if (line.startsWith('Total') || line.startsWith('Итого')) return false;
      return true;
    });

    if (lines.length === 0) return [];

    const headers = lines[0].split('\t');
    const rows = [];
    const limit = Math.min(lines.length, 501); // headers + 500 data rows

    for (let i = 1; i < limit; i++) {
      const values = lines[i].split('\t');
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] ?? '';
      }
      rows.push(row);
    }

    return rows;
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
   * Register an action tool (suspend, resume, archive, unarchive, delete, moderate).
   * Accepts an array of IDs and calls `service.{method}`.
   */
  function registerActionTool(server, toolName, service, method, description) {
    server.tool(
      toolName,
      description,
      {
        ids: z.array(z.number()).describe('Array of entity IDs to act on'),
      },
      async ({ ids }) => {
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
      },
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
   */
  function registerUpdateTool(server, toolName, service, description, itemsKey, itemsDesc) {
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
    );
  }

  // --- MCP Server ---

  const server = new McpServer({ name: 'yandex-direct-mcp', version: '1.0.0' });

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
  );

  registerActionTool(server, 'delete_campaigns', 'campaigns', 'delete', 'Delete campaigns by IDs.');
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
  );

  registerActionTool(server, 'delete_adgroups', 'adgroups', 'delete', 'Delete ad groups by IDs.');
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
  );

  registerActionTool(server, 'delete_ads', 'ads', 'delete', 'Delete ads by IDs.');
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
  );

  registerActionTool(server, 'delete_keywords', 'keywords', 'delete', 'Delete keywords by IDs.');
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
  server.tool(
    'set_keyword_bids',
    'Set keyword bids. Pass a JSON array of bid objects with KeywordId, SearchBid (in micros), and/or NetworkBid (in micros).',
    {
      bids_json: z
        .string()
        .describe('JSON array of bid objects, e.g. [{"KeywordId":12345,"SearchBid":30000000,"NetworkBid":10000000}]'),
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
  );

  // set auto keyword bids (custom)
  server.tool(
    'set_auto_keyword_bids',
    'Set automatic keyword bids (strategy-level). Pass a JSON array of auto-bid objects. Common fields: CampaignId, AdGroupId, KeywordId, Bid, ContextBid, and strategy parameters.',
    {
      bids_json: z
        .string()
        .describe(
          'JSON array of auto-bid setting objects, e.g. [{"CampaignId":123,"AdGroupId":456,"MaxBid":50000000}]',
        ),
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
  server.tool(
    'set_bid_modifiers',
    'Update bid modifier values. Pass a JSON array of objects with Id and the new adjustment value.',
    {
      modifiers_json: z
        .string()
        .describe('JSON array of bid modifier update objects, e.g. [{"Id":11111,"BidModifier":120}]'),
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
  );

  registerActionTool(server, 'delete_bid_modifiers', 'bidmodifiers', 'delete', 'Delete bid modifiers by IDs.');

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

  registerActionTool(server, 'delete_sitelinks', 'sitelinks', 'delete', 'Delete sitelink sets by IDs.');

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

  registerActionTool(server, 'delete_vcards', 'vcards', 'delete', 'Delete VCards by IDs.');

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
