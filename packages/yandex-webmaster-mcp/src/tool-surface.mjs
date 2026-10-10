/**
 * Model-facing descriptions and annotations for yandex-webmaster-mcp.
 *
 * index.mjs keeps the input schemas and registers every tool through
 * createToolRegistrar() below, which hands the final description and
 * annotations to the SDK's public registerTool() at registration time.
 * Startup fails if a tool is missing from this map or this map names a tool
 * that was not registered. Existing write annotations are kept and must agree
 * with this map.
 */

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const DESTROY = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const SURFACE = {
  'get-user': {
    annotations: READ,
    useWhen:
      'Use when the user needs the Webmaster account id before a call that is not already scoped to a host. Do not use it to list sites; call list-hosts, which also returns the host_id every other tool expects.',
  },
  'list-hosts': {
    annotations: READ,
    useWhen:
      'Use when the user asks which sites are in Webmaster or needs a host_id for any later call. Do not use it for one site SQI or problems; call get-summary or get-diagnostics after the host_id is known.',
  },
  'get-host': {
    annotations: READ,
    useWhen:
      'Use when the user wants the verification flag and data status of one host. Do not use it to list every site; call list-hosts. Do not use it to start the ownership check; call start-verification after verify-host.',
  },
  'get-summary': {
    annotations: READ,
    useWhen:
      'Use when the user wants the current SQI, page counts, and problem totals for a host. Do not use it for the list of excluded URLs; call get-excluded-pages. Do not use it for SQI over time; call get-sqi-history.',
  },
  'get-sqi-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks how the Site Quality Index changed over a date range. Do not use it for the single current SQI; call get-summary. Do not use it for indexing counts; call get-indexing-history.',
  },
  'get-diagnostics': {
    annotations: READ,
    useWhen:
      'Use when the user asks what site problems Yandex currently reports, such as mobile or security issues. Do not use it for pages that dropped out of search; call get-excluded-pages or get-search-events-samples.',
  },
  'get-popular-queries': {
    annotations: READ,
    useWhen:
      'Use when the user wants the top queries for a site by shows or clicks. Do not use it for the day-by-day totals of all queries; call get-query-history. Do not use it for pages in search; call get-insearch-samples.',
  },
  'get-query-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks how shows, clicks, or average position moved over time for the site as a whole. Do not use it for the ranking of individual queries; call get-popular-queries.',
  },
  'get-indexing-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks how the number of indexed pages changed over time. Do not use it for example URLs; call get-indexing-samples. Do not use it for pages that appear in search results; call get-insearch-history.',
  },
  'get-indexing-samples': {
    annotations: READ,
    useWhen:
      'Use when the user wants example URLs Yandex has indexed. Do not use it for the count over time; call get-indexing-history. Do not use it for URLs that dropped out of results; call get-search-events-samples.',
  },
  'get-insearch-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks how many pages were present in search results over time. Do not use it for example URLs; call get-insearch-samples. Do not use it for the indexed-page series; call get-indexing-history.',
  },
  'get-insearch-samples': {
    annotations: READ,
    useWhen:
      'Use when the user wants example URLs that currently appear in search. Do not use it for pages that were removed; call get-search-events-samples or get-excluded-pages. Do not use it for the history series; call get-insearch-history.',
  },
  'get-search-events-history': {
    annotations: READ,
    useWhen:
      'Use when the user wants the count of appeared and removed search URLs over time. Do not use it for the URLs themselves or the exclusion reason; call get-search-events-samples or get-excluded-pages.',
  },
  'get-search-events-samples': {
    annotations: READ,
    useWhen:
      'Use when the user wants sample URLs that appeared in or left search, including excluded_url_status. Do not use it to walk only dropped pages across a window; call get-excluded-pages. Do not use it for the event counts; call get-search-events-history.',
  },
  'get-excluded-pages': {
    annotations: READ,
    useWhen:
      'Use when the user asks which pages dropped out of search and why, inside a scanned window. Do not use it for the aggregate excluded_pages_count; that number comes from get-summary and is a different kind of count. Do not use it for a single mixed page of events; call get-search-events-samples.',
  },
  'get-external-links': {
    annotations: READ,
    useWhen:
      'Use when the user wants sample pages on other sites that link to this host. Do not use it for the count over time; call get-external-links-history. Do not use it for broken links inside the site; call get-broken-internal-links.',
  },
  'get-external-links-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks whether the number of external links rose or fell. Do not use it for the linking URLs themselves; call get-external-links. Do not use it for internal broken links; call get-broken-internal-links-history.',
  },
  'get-broken-internal-links': {
    annotations: READ,
    useWhen:
      'Use when the user asks which internal links look broken and whether Yandex has rechecked them. Do not use it for the count over time; call get-broken-internal-links-history. Do not use it for links from other sites; call get-external-links.',
  },
  'get-broken-internal-links-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks how the broken-internal-link count changed over time. Do not use it for the source and destination URLs; call get-broken-internal-links, and read source_last_access_date before treating a row as a live failure.',
  },
  'get-sitemaps': {
    annotations: READ,
    useWhen:
      'Use when the user wants every sitemap Yandex knows for the host, including ones it discovered. Do not use it for only the files the user uploaded; call get-user-sitemaps. Do not use it to add a file; call add-sitemap.',
  },
  'get-sitemap': {
    annotations: READ,
    useWhen:
      'Use when the user already has a sitemap id and wants that file details. Do not use it to list files; call get-sitemaps or get-user-sitemaps. Do not use it to upload a sitemap; call add-sitemap.',
  },
  'get-user-sitemaps': {
    annotations: READ,
    useWhen:
      'Use when the user asks which sitemap files were added by hand. Do not use it for sitemaps Yandex found on its own; call get-sitemaps. Do not use it to add a file; call add-sitemap.',
  },
  'add-sitemap': {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to register a sitemap URL on an already verified host. Do not use it to list files; call get-user-sitemaps. Do not use it to delete the host; call delete-host, which is irreversible and requires confirm.',
  },
  'get-important-urls': {
    annotations: READ,
    useWhen:
      'Use when the user wants the important URLs configured for the host. Do not use it for the history of one URL; call get-important-url-history. Do not use it for indexed samples; call get-indexing-samples.',
  },
  'get-important-url-history': {
    annotations: READ,
    useWhen:
      'Use when the user asks how one important URL changed over time. Do not use it to list the important URLs; call get-important-urls. Do not use it for search-event samples; call get-search-events-samples.',
  },
  'get-recrawl-quota': {
    annotations: READ,
    useWhen:
      'Use when the user asks how many recrawl requests are left today. Do not use it to send a URL; call add-recrawl-url. Do not use it to see queued tasks; call get-recrawl-queue.',
  },
  'add-recrawl-url': {
    annotations: WRITE,
    useWhen:
      'Use when the user asks Yandex to recrawl one URL and the daily quota still has room. Do not use it to check the quota first; call get-recrawl-quota. Do not use it to read a task later; call get-recrawl-task with the returned task id.',
  },
  'get-recrawl-queue': {
    annotations: READ,
    useWhen:
      'Use when the user wants the list of URLs already sent for recrawl and their states. Do not use it for one known task id; call get-recrawl-task. Do not use it to enqueue a URL; call add-recrawl-url.',
  },
  'get-recrawl-task': {
    annotations: READ,
    useWhen:
      'Use when the user has a task id from add-recrawl-url and wants that task state. Do not use it to list the queue; call get-recrawl-queue. Do not use it to spend quota; call add-recrawl-url.',
  },
  'add-host': {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to add a new site to Webmaster. Do not use it to check ownership; call verify-host, then start-verification. Do not use it to remove a site; call delete-host, which is irreversible and requires confirm.',
  },
  'verify-host': {
    annotations: READ,
    useWhen:
      'Use when the user wants the current verification state, the UIN, or which methods are available. Do not use it to start the check; call start-verification. Do not use it to add the site; call add-host.',
  },
  'start-verification': {
    annotations: WRITE,
    useWhen:
      'Use when the verification file, meta tag, or DNS record is already in place and the user wants the ownership check started. Do not use it to read the UIN or the failure reason; call verify-host. Do not use it to add the host; call add-host.',
  },
  'delete-host': {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to remove a site from Webmaster and accepts that its history is lost. Do not use it to add a site; call add-host. Do not use it to drop one URL from search; this tool deletes the whole host.',
  },
};

const REQUIRED_HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'];

/**
 * Build the final description and annotations for one tool from what index.mjs
 * passed and the entry in SURFACE. Throws on any disagreement, so a bad entry
 * stops the server at startup instead of reaching a client.
 */
function surfaceFor(name, baseDescription, baseAnnotations) {
  if (!Object.hasOwn(SURFACE, name)) {
    throw new Error(`tool surface mismatch; ${name} is registered but has no entry in SURFACE`);
  }
  const spec = SURFACE[name];
  if (!spec.useWhen.startsWith('Use when ')) {
    throw new Error(`${name}: useWhen must start with "Use when "`);
  }
  let base = String(baseDescription ?? '').trim();
  if (!/[.!?]$/.test(base)) base += '.';
  const description = `${base} ${spec.useWhen}`;
  const words = description.split(/\s+/).filter(Boolean);
  if (words.length < 25) {
    throw new Error(`${name}: description has ${words.length} words`);
  }
  const prev = baseAnnotations && typeof baseAnnotations === 'object' ? baseAnnotations : {};
  const next = spec.annotations;
  for (const key of REQUIRED_HINTS) {
    if (typeof prev[key] === 'boolean' && prev[key] !== next[key]) {
      throw new Error(`${name}: refusing to change ${key} from ${prev[key]} to ${next[key]}`);
    }
  }
  if (typeof prev.idempotentHint === 'boolean' && prev.idempotentHint !== next.idempotentHint) {
    throw new Error(`${name}: refusing to change idempotentHint`);
  }
  const annotations = { ...next, ...prev };
  for (const key of REQUIRED_HINTS) {
    if (typeof annotations[key] !== 'boolean') {
      throw new Error(`${name}: ${key} is not set`);
    }
  }
  if (annotations.readOnlyHint === true && annotations.destructiveHint === true) {
    throw new Error(`${name}: readOnlyHint and destructiveHint are both true`);
  }
  return { description, annotations };
}

/**
 * Register tools through the SDK's public `registerTool(name, config, cb)`,
 * with the final description and annotations already in `config`. Nothing is
 * patched after registration, so no private SDK field is read or written.
 *
 * `tool(name, description, inputShape, cb)` keeps the short call form used in
 * index.mjs and maps it onto `registerTool`; both end in the same SDK path, so
 * the input schema and the handler signature stay as they were.
 *
 * Call `finish()` once every tool is registered: it fails startup when SURFACE
 * names a tool that was never registered.
 */
export function createToolRegistrar(server) {
  const registered = new Set();
  const registerTool = (name, config, cb) => {
    if (!config || typeof config !== 'object') {
      throw new Error(`${name}: registerTool needs a config object`);
    }
    if (typeof cb !== 'function') {
      throw new Error(`${name}: registerTool needs a handler`);
    }
    const { description, annotations } = surfaceFor(name, config.description, config.annotations);
    const result = server.registerTool(name, { ...config, description, annotations }, cb);
    registered.add(name);
    return result;
  };
  const tool = (name, description, inputShape, cb, ...extra) => {
    if (
      extra.length > 0 ||
      typeof description !== 'string' ||
      !inputShape ||
      typeof inputShape !== 'object' ||
      Array.isArray(inputShape) ||
      typeof cb !== 'function'
    ) {
      throw new Error(`${name}: tool() takes exactly (name, description, inputShape, handler)`);
    }
    return registerTool(name, { description, inputSchema: inputShape }, cb);
  };
  const finish = () => {
    const extra = Object.keys(SURFACE).filter((name) => !registered.has(name));
    if (extra.length > 0) {
      throw new Error(`tool surface mismatch; missing []; extra [${extra.join(', ')}]`);
    }
  };
  return { tool, registerTool, finish };
}
