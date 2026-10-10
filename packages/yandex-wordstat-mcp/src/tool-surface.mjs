/**
 * Model-facing descriptions and annotations for yandex-wordstat-mcp.
 *
 * index.mjs keeps the input schemas. The SDK (1.27.1) stores each tool on
 * `server._registeredTools` and reads `description` / `annotations` only when
 * a client calls tools/list, so filling them in here does not touch the schema.
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

export function applyToolSurface(server) {
  const tools = server._registeredTools;
  if (!tools || typeof tools !== 'object') {
    throw new Error('yandex-wordstat-mcp: SDK did not expose _registeredTools');
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
