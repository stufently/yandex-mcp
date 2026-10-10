/**
 * Model-facing descriptions and annotations for yandex-wordstat-mcp.
 *
 * index.mjs keeps the input schemas and registers every tool through
 * createToolRegistrar() below, which hands the final description and
 * annotations to the SDK's public registerTool() at registration time.
 * Startup fails if a tool is missing from this map or this map names a tool
 * that was not registered.
 */

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const SURFACE = {
  'get-regions-tree': {
    annotations: READ,
    useWhen:
      'Use when the user needs Yandex region ids and the hierarchy before filtering other Wordstat calls. Do not use it to measure how often a phrase is searched; call top-requests, dynamics, or regions for demand.',
  },
  'get-region-children': {
    annotations: READ,
    useWhen:
      'Use when the user already has one region id and wants only that region children, not the whole tree. Do not use it for phrase demand; call top-requests or regions, and call get-regions-tree to browse from the root.',
  },
  'top-requests': {
    annotations: READ,
    useWhen:
      'Use when the user asks how often people search a phrase on Yandex in the last 30 days and which related queries appear. Do not use it for a multi-month trend; call dynamics. Do not use it for region ids; call get-regions-tree.',
  },
  dynamics: {
    annotations: READ,
    useWhen:
      'Use when the user asks whether demand for one phrase is growing or falling over days, weeks, or months. Do not use it for the list of related queries; call top-requests. Do not use it to compare regions; call regions.',
  },
  regions: {
    annotations: READ,
    useWhen:
      'Use when the user asks which regions search a phrase the most, or wants volume and affinity by region. Do not use it to browse the region tree; call get-regions-tree. Do not use it for a time trend; call dynamics.',
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
