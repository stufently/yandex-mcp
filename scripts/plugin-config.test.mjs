/**
 * The Claude Code plugin wiring: `.claude-plugin/plugin.json` userConfig,
 * `plugin.mcp.json` and `scripts/plugin-launch.mjs`.
 *
 * The plugin directory refuses credentials read from the user's environment
 * (`${YANDEX_*}` in the MCP config) and wants secrets in `userConfig` with
 * `sensitive: true`. The launcher keeps the old environment variables working
 * for options the user left empty.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { callTool, textOf } from './lib/call-tool.mjs';
import { handshake } from './lib/list-tools.mjs';
import { ALLOWED, applyPluginConfig, PREFIX, SERVERS, serverEntry } from './plugin-launch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const mcp = JSON.parse(readFileSync(join(ROOT, 'plugin.mcp.json'), 'utf8'));
const LAUNCHER = join(ROOT, 'scripts', 'plugin-launch.mjs');

test('a non-empty plugin option replaces the environment variable', () => {
  const env = { YANDEX_WEBMASTER_TOKEN: 'from-shell', [`${PREFIX}YANDEX_WEBMASTER_TOKEN`]: 'from-plugin' };
  applyPluginConfig(env);
  assert.deepEqual(env, { YANDEX_WEBMASTER_TOKEN: 'from-plugin' });
});

test('an empty plugin option keeps the environment variable', () => {
  const env = { YANDEX_METRIKA_TOKEN: 'from-shell', [`${PREFIX}YANDEX_METRIKA_TOKEN`]: '' };
  applyPluginConfig(env);
  assert.deepEqual(env, { YANDEX_METRIKA_TOKEN: 'from-shell' });
});

test('an empty plugin option does not create the variable', () => {
  const env = { [`${PREFIX}YANDEX_DIRECT_TOKEN`]: '' };
  applyPluginConfig(env);
  assert.deepEqual(env, {});
});

test('a prefixed name outside the allowlist is dropped, not copied', () => {
  const env = { [`${PREFIX}NODE_OPTIONS`]: '--require=/tmp/x.js' };
  applyPluginConfig(env);
  assert.deepEqual(env, {});
});

test('serverEntry knows the five servers and nothing else', () => {
  for (const [short, pkg] of Object.entries(SERVERS)) {
    assert.equal(serverEntry(short), join(ROOT, 'packages', pkg, 'src', 'index.mjs'));
  }
  assert.equal(serverEntry('toString'), undefined);
  assert.equal(serverEntry(undefined), undefined);
});

test('plugin.mcp.json reads only declared userConfig options, never the environment', () => {
  const options = manifest.userConfig;
  const used = new Set();
  const servers = Object.values(mcp.mcpServers);
  assert.equal(servers.length, 5);
  const shorts = [];
  for (const server of servers) {
    assert.equal(server.command, 'node');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code placeholder, not a JS template
    assert.equal(server.args[0], '${CLAUDE_PLUGIN_ROOT}/scripts/plugin-launch.mjs');
    assert.equal(server.args.length, 2);
    shorts.push(server.args[1]);
    for (const [name, value] of Object.entries(server.env)) {
      assert.ok(name.startsWith(PREFIX), `${name} must carry ${PREFIX}`);
      assert.ok(ALLOWED.has(name.slice(PREFIX.length)), `${name} is not a variable the launcher copies`);
      const m = /^\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
      assert.ok(m, `${name} must be exactly one \${user_config.*} reference, got ${value}`);
      assert.ok(Object.hasOwn(options, m[1]), `${m[1]} is not declared in userConfig`);
      used.add(m[1]);
    }
  }
  assert.deepEqual(shorts.sort(), Object.keys(SERVERS).sort());
  assert.deepEqual([...used].sort(), Object.keys(options).sort(), 'every declared option is used');
  assert.doesNotMatch(JSON.stringify(mcp), /\$\{(?!user_config\.|CLAUDE_PLUGIN_ROOT\})/);
});

test('every token and API key option is sensitive and optional', () => {
  for (const [key, option] of Object.entries(manifest.userConfig)) {
    if (/_(token|key)$/.test(key)) assert.equal(option.sensitive, true, `${key} must be sensitive`);
    else assert.notEqual(option.sensitive, true, `${key} is not a secret`);
    assert.notEqual(option.required, true, `${key}: one API at a time, so nothing is required`);
  }
});

for (const short of Object.keys(SERVERS)) {
  test(`the launcher starts ${short} with credentials from plugin options only`, async () => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    for (const name of ALLOWED) env[`${PREFIX}${name}`] = name === 'YANDEX_DIRECT_SANDBOX' ? 'true' : 'smoke';
    const { tools } = await handshake(SERVERS[short], {
      clientName: 'plugin-launch',
      command: [process.execPath, LAUNCHER, short],
      env,
    });
    assert.ok(tools.length > 0, `${short} exposed no tools`);
  });
}

// tools/list works without credentials, so the handshake above cannot tell whether a
// token reached the server. A real tool call can: without the token Metrika refuses
// before any request, with it the call reaches the (stubbed) API and gets its 400.
const METRIKA_400 = [{ match: '/stat/v1/data', status: 400, body: { message: 'stubbed' } }];
const baseEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME });

async function metrikaThroughLauncher(env) {
  return callTool('yandex-metrika-mcp', 'get-traffic-summary', { counter_id: 12345 }, METRIKA_400, {
    env,
    entry: [LAUNCHER, 'metrika'],
  });
}

test('a token set only as a plugin option reaches the server', async () => {
  const result = await metrikaThroughLauncher({ ...baseEnv(), [`${PREFIX}YANDEX_METRIKA_TOKEN`]: 'smoke' });
  assert.doesNotMatch(textOf(result), /YANDEX_METRIKA_TOKEN is required/);
  assert.match(textOf(result), /stubbed/);
});

test('an empty plugin option falls back to the token from the environment', async () => {
  const result = await metrikaThroughLauncher({
    ...baseEnv(),
    YANDEX_METRIKA_TOKEN: 'smoke',
    [`${PREFIX}YANDEX_METRIKA_TOKEN`]: '',
  });
  assert.doesNotMatch(textOf(result), /YANDEX_METRIKA_TOKEN is required/);
  assert.match(textOf(result), /stubbed/);
});

test('with neither a plugin option nor the variable the server asks for the token', async () => {
  const result = await metrikaThroughLauncher({ ...baseEnv(), [`${PREFIX}YANDEX_METRIKA_TOKEN`]: '' });
  assert.ok(result.isError);
  assert.match(textOf(result), /YANDEX_METRIKA_TOKEN is required/);
});
