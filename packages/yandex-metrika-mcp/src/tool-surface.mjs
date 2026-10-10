/**
 * Model-facing descriptions and annotations for yandex-metrika-mcp.
 *
 * index.mjs keeps the input schemas. The SDK (1.27.1) stores each tool on
 * `server._registeredTools` and reads `description` / `annotations` only when
 * a client calls tools/list, so filling them in here does not touch the schema.
 * Startup fails if a tool is missing from this map or this map names a tool
 * that was not registered. Existing destructive annotations are kept and must
 * agree with this map.
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
  'get-counters': {
    annotations: READ,
    useWhen:
      'Use when the user wants the list of Metrika counters and their ids before any report. Do not use it for visits or traffic; call get-traffic-summary or another report tool once a counter id is known.',
  },
  'get-counter': {
    annotations: READ,
    useWhen:
      'Use when the user asks for the settings of one known Metrika counter, such as its name, site, or status. Do not use it to list every counter; call get-counters. Do not use it for visit numbers; call a report tool.',
  },
  'get-goals': {
    annotations: READ,
    useWhen:
      'Use when the user asks which conversion goals exist on a counter. Do not use it for visit totals; call get-traffic-summary. Do not use it to create a counter; call create-counter.',
  },
  'create-counter': {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to add a new site to Metrika and a write-capable token is available. Do not use it to remove a counter; call delete-counter, which is irreversible and requires confirm. Do not use it to read an existing counter; call get-counter.',
  },
  'delete-counter': {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete one Metrika counter and accepts that its statistics are lost. Do not use it to create a site; call create-counter. Do not use it to inspect a counter; call get-counter.',
  },
  'get-traffic-summary': {
    annotations: READ,
    useWhen:
      'Use when the user wants visits, users, pageviews, bounce rate, or average duration for a counter over a date range. Do not use it for a breakdown by source, city, or page; call get-traffic-sources, get-geography, or get-popular-pages.',
  },
  'get-traffic-sources': {
    annotations: READ,
    useWhen:
      'Use when the user asks where visits came from, such as organic search, ads, or direct. Do not use it for the headline totals only; call get-traffic-summary. Do not use it for landing pages; call get-popular-pages.',
  },
  'get-geography': {
    annotations: READ,
    useWhen:
      'Use when the user asks which countries or cities the visitors come from. Do not use it for devices or browsers; call get-devices. Do not use it for traffic sources; call get-traffic-sources.',
  },
  'get-devices': {
    annotations: READ,
    useWhen:
      'Use when the user asks for a breakdown by device, browser, or operating system. Do not use it for countries and cities; call get-geography. Do not use it for the headline visit total; call get-traffic-summary.',
  },
  'get-popular-pages': {
    annotations: READ,
    useWhen:
      'Use when the user asks which pages got the most pageviews. Do not use it for the queries that brought people in; call get-search-phrases. Do not use it for an arbitrary metric; call get-report.',
  },
  'get-search-phrases': {
    annotations: READ,
    useWhen:
      'Use when the user asks which search phrases sent visits to the site. Do not use it for Yandex-wide keyword volume outside this counter; that is Wordstat, not this server. Do not use it for pageview leaders; call get-popular-pages.',
  },
  'get-report': {
    annotations: READ,
    useWhen:
      'Use when the user needs a custom Metrika table with chosen metrics and dimensions that no dedicated tool covers. Do not use it for the standard visit summary; call get-traffic-summary. Do not use it to change the counter; this tool only reads.',
  },
};

const REQUIRED_HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'];

export function applyToolSurface(server) {
  const tools = server._registeredTools;
  if (!tools || typeof tools !== 'object') {
    throw new Error('yandex-metrika-mcp: SDK did not expose _registeredTools');
  }
  const missing = Object.keys(tools).filter((name) => !Object.hasOwn(SURFACE, name));
  const extra = Object.keys(SURFACE).filter((name) => !Object.hasOwn(tools, name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`tool surface mismatch; missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
  }
  for (const name of Object.keys(tools)) {
    const tool = tools[name];
    const spec = SURFACE[name];
    if (!spec.useWhen.startsWith('Use when ')) {
      throw new Error(`${name}: useWhen must start with "Use when "`);
    }
    let base = String(tool.description ?? '').trim();
    if (!/[.!?]$/.test(base)) base += '.';
    const description = `${base} ${spec.useWhen}`;
    const words = description.split(/\s+/).filter(Boolean);
    if (words.length < 25) {
      throw new Error(`${name}: description has ${words.length} words`);
    }
    const prev = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
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
      if (typeof annotations[key] !== 'boolean') throw new Error(`${name}: ${key} is not set`);
    }
    if (annotations.readOnlyHint === true && annotations.destructiveHint === true) {
      throw new Error(`${name}: readOnlyHint and destructiveHint are both true`);
    }
    tool.description = description;
    tool.annotations = annotations;
  }
}
