#!/usr/bin/env node
/**
 * Entry point the Claude Code plugin starts instead of a server's index.mjs.
 *
 * The plugin takes credentials from its `userConfig` (sensitive values live in
 * the system credential store) and hands them over as `YANDEX_MCP_PLUGIN_<NAME>`
 * variables. Claude Code substitutes an option the user left unset with an empty
 * string, so the plugin cannot write `<NAME>` itself: an empty value would hide
 * the same variable a user already exports in the shell or in
 * `~/.claude/settings.json`. This launcher copies each non-empty
 * `YANDEX_MCP_PLUGIN_<NAME>` onto `<NAME>`, leaves `<NAME>` alone when the
 * option is empty, removes the `YANDEX_MCP_PLUGIN_*` variables and then runs
 * the server in the same process.
 *
 * Usage: node scripts/plugin-launch.mjs <search|wordstat|webmaster|metrika|direct> [args...]
 */
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PREFIX = 'YANDEX_MCP_PLUGIN_';

/** Variables the plugin may set; anything else under the prefix is dropped. */
export const ALLOWED = new Set([
  'YANDEX_SEARCH_API_KEY',
  'YANDEX_FOLDER_ID',
  'WORDSTAT_API_KEY',
  'WORDSTAT_FOLDER_ID',
  'YANDEX_WEBMASTER_TOKEN',
  'YANDEX_METRIKA_TOKEN',
  'YANDEX_DIRECT_TOKEN',
  'YANDEX_DIRECT_CLIENT_LOGIN',
  'YANDEX_DIRECT_SANDBOX',
]);

export const SERVERS = {
  search: 'yandex-search-mcp',
  wordstat: 'yandex-wordstat-mcp',
  webmaster: 'yandex-webmaster-mcp',
  metrika: 'yandex-metrika-mcp',
  direct: 'yandex-direct-mcp',
};

/**
 * Move plugin options onto the variables the servers read. Mutates `env`.
 * @param {Record<string, string | undefined>} env
 */
export function applyPluginConfig(env) {
  for (const key of Object.keys(env)) {
    if (!key.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    const value = env[key];
    delete env[key];
    if (ALLOWED.has(name) && value !== undefined && value !== '') env[name] = value;
  }
  return env;
}

/** @param {string} short */
export function serverEntry(short) {
  const pkg = Object.hasOwn(SERVERS, short) ? SERVERS[short] : undefined;
  if (!pkg) return undefined;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return join(root, 'packages', pkg, 'src', 'index.mjs');
}

async function main() {
  const [short, ...rest] = process.argv.slice(2);
  const entry = serverEntry(short);
  if (!entry) {
    console.error(`usage: plugin-launch.mjs <${Object.keys(SERVERS).join('|')}> [args...]`);
    process.exit(2);
  }
  applyPluginConfig(process.env);
  // The servers read their subcommand from argv[2] and name argv[1] in errors.
  process.argv = [process.argv[0], entry, ...rest];
  await import(pathToFileURL(entry).href);
}

// Run only when started as a script, not when a test imports the helpers.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
