/**
 * Model-facing descriptions and annotations for yandex-direct-mcp.
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

/** Statistics only. A new report name is allocated, but campaigns and money stay put. */
const REPORT = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const SURFACE = {
  get_campaigns: {
    annotations: READ,
    useWhen:
      'Use when the user wants to see Direct campaigns, their states, types, or budgets before changing anything. Do not use it to edit a campaign; call update_campaigns. Do not use it to pause one; call suspend_campaigns.',
  },
  add_campaigns: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to create new campaigns. Do not use it to change an existing campaign; call update_campaigns, which overwrites values and requires confirm. Do not use it to list campaigns; call get_campaigns.',
  },
  update_campaigns: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to overwrite campaign fields and accepts that the previous values are lost. Do not use it to pause delivery; call suspend_campaigns. Do not use it to inspect campaigns; call get_campaigns.',
  },
  delete_campaigns: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete campaigns and accepts that they cannot be restored. Do not use it to pause them; call suspend_campaigns. Do not use it to archive them; call archive_campaigns, which can be undone with unarchive_campaigns.',
  },
  archive_campaigns: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants campaigns archived and still restorable. Do not use it to delete them forever; call delete_campaigns. Do not use it to bring archived campaigns back; call unarchive_campaigns.',
  },
  unarchive_campaigns: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants archived campaigns returned to a workable state. Do not use it to archive them; call archive_campaigns. Do not use it to delete them; call delete_campaigns.',
  },
  suspend_campaigns: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants to pause campaign delivery without deleting anything. Do not use it to resume delivery; call resume_campaigns. Do not use it to delete campaigns; call delete_campaigns.',
  },
  resume_campaigns: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants suspended campaigns to deliver again. Do not use it to pause them; call suspend_campaigns. Do not use it to change bids; call set_keyword_bids only after the user accepts the spend.',
  },
  get_adgroups: {
    annotations: READ,
    useWhen:
      'Use when the user wants to list ad groups and their regions or statuses. Do not use it to change an ad group; call update_adgroups. Do not use it for the ads inside a group; call get_ads.',
  },
  add_adgroups: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to create ad groups inside a campaign. Do not use it to edit an existing group; call update_adgroups. Do not use it to list groups; call get_adgroups.',
  },
  update_adgroups: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to overwrite ad group fields. Do not use it to archive a group; call archive_adgroups. Do not use it to read groups; call get_adgroups.',
  },
  delete_adgroups: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete ad groups and their stats. Do not use it to archive them; call archive_adgroups. Do not use it to delete only the ads; call delete_ads.',
  },
  archive_adgroups: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants ad groups archived and still restorable. Do not use it to delete them; call delete_adgroups. Do not use it to restore them; call unarchive_adgroups.',
  },
  unarchive_adgroups: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants archived ad groups restored. Do not use it to archive them; call archive_adgroups. Do not use it to delete them; call delete_adgroups.',
  },
  get_ads: {
    annotations: READ,
    useWhen:
      'Use when the user wants to read ads, their texts, and moderation status. Do not use it to change an ad; call update_ads. Do not use it to send ads to moderation; call moderate_ads.',
  },
  add_ads: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to create ads in an ad group. Do not use it to rewrite an existing ad; call update_ads. Do not use it to list ads; call get_ads.',
  },
  update_ads: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to overwrite ad text or links. Do not use it to send ads to moderation; call moderate_ads. Do not use it to read ads; call get_ads.',
  },
  delete_ads: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete ads. Do not use it to archive them; call archive_ads. Do not use it to delete the whole ad group; call delete_adgroups.',
  },
  archive_ads: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants ads archived and still restorable. Do not use it to delete them; call delete_ads. Do not use it to restore them; call unarchive_ads.',
  },
  unarchive_ads: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants archived ads restored. Do not use it to archive them; call archive_ads. Do not use it to delete them; call delete_ads.',
  },
  moderate_ads: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants existing ads submitted for moderation. Do not use it to rewrite the ad; call update_ads. Do not use it to read the current moderation status; call get_ads.',
  },
  get_keywords: {
    annotations: READ,
    useWhen:
      'Use when the user wants keyword texts, states, and which ad group they belong to. Do not use it for the money bid on a keyword; call get_keyword_bids. Do not use it to add keywords; call add_keywords.',
  },
  add_keywords: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to add keyword phrases to an ad group. Do not use it to change an existing phrase; call update_keywords. Do not use it to set the bid; call set_keyword_bids only when the user accepts the spend.',
  },
  update_keywords: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to overwrite keyword fields. Do not use it to pause a keyword; call suspend_keywords. Do not use it to read keywords; call get_keywords.',
  },
  delete_keywords: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete keywords. Do not use it to pause them; call suspend_keywords. Do not use it to change bids; call set_keyword_bids.',
  },
  suspend_keywords: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants to stop keywords from matching without deleting them. Do not use it to turn them back on; call resume_keywords. Do not use it to delete them; call delete_keywords.',
  },
  resume_keywords: {
    annotations: WRITE,
    useWhen:
      'Use when the user wants suspended keywords to match again. Do not use it to pause them; call suspend_keywords. Do not use it to change what they cost; call set_keyword_bids.',
  },
  get_keyword_bids: {
    annotations: READ,
    useWhen:
      'Use when the user wants the current search or network bid for keywords. Do not use it to change a bid; call set_keyword_bids, which spends money and requires confirm. Do not use it for bid modifiers; call get_bid_modifiers.',
  },
  set_keyword_bids: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to set keyword bids and accepts that the account will spend money. Do not use it to read the current bid; call get_keyword_bids. Do not use it for automatic strategy settings; call set_auto_keyword_bids.',
  },
  set_auto_keyword_bids: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to change automatic bidding settings and accepts the spend. Do not use it for a manual search bid; call set_keyword_bids. Do not use it to read bids; call get_keyword_bids.',
  },
  get_bid_modifiers: {
    annotations: READ,
    useWhen:
      'Use when the user wants the current bid adjustments for device, demographics, or region. Do not use it to change an adjustment; call set_bid_modifiers. Do not use it to add one; call add_bid_modifiers.',
  },
  add_bid_modifiers: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to add a new bid adjustment. Do not use it to change an existing adjustment; call set_bid_modifiers, which spends money and requires confirm. Do not use it to list them; call get_bid_modifiers.',
  },
  set_bid_modifiers: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to change bid adjustment values and accepts the spend. Do not use it to add a new adjustment; call add_bid_modifiers. Do not use it to read them; call get_bid_modifiers.',
  },
  delete_bid_modifiers: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete bid adjustments. Do not use it to change their values; call set_bid_modifiers. Do not use it to read them; call get_bid_modifiers.',
  },
  get_sitelinks: {
    annotations: READ,
    useWhen:
      'Use when the user wants to read sitelink sets. Do not use it to create a set; call add_sitelinks. Do not use it to delete a set; call delete_sitelinks.',
  },
  add_sitelinks: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to create sitelink sets. Do not use it to delete a set; call delete_sitelinks. Do not use it to list sets; call get_sitelinks.',
  },
  delete_sitelinks: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete sitelink sets. Do not use it to create them; call add_sitelinks. Do not use it to read them; call get_sitelinks.',
  },
  get_vcards: {
    annotations: READ,
    useWhen:
      'Use when the user wants to read business cards attached to campaigns. Do not use it to create one; call add_vcards. Do not use it to delete one; call delete_vcards.',
  },
  add_vcards: {
    annotations: WRITE,
    useWhen:
      'Use when the user asks to add business cards. Do not use it to delete them; call delete_vcards. Do not use it to list them; call get_vcards.',
  },
  delete_vcards: {
    annotations: DESTROY,
    useWhen:
      'Use when the user has explicitly asked to delete business cards. Do not use it to create them; call add_vcards. Do not use it to read them; call get_vcards.',
  },
  create_report: {
    annotations: REPORT,
    useWhen:
      'Use when the user wants impressions, clicks, or cost for campaigns, ads, or queries over a date range. Do not use it to change a campaign or a bid; it only reads statistics. Do not use it to list campaigns; call get_campaigns.',
  },
  get_dictionaries: {
    annotations: READ,
    useWhen:
      'Use when the user needs reference ids such as regions, currencies, or time zones before building a campaign. Do not use it for account performance; call create_report. Do not use it for the client profile; call get_clients.',
  },
  get_clients: {
    annotations: READ,
    useWhen:
      'Use when the user is an agency and needs the client logins this token can act for. Do not use it to switch the client; set YANDEX_DIRECT_CLIENT_LOGIN. Do not use it to list campaigns; call get_campaigns.',
  },
};

const REQUIRED_HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'];

export function applyToolSurface(server) {
  const tools = server._registeredTools;
  if (!tools || typeof tools !== 'object') {
    throw new Error('yandex-direct-mcp: SDK did not expose _registeredTools');
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
