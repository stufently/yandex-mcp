/**
 * The servers must reach the MCP SDK only through its public API.
 *
 * Descriptions and annotations used to be written into the SDK's private
 * `server._registeredTools` after registration. The npm range is `^1.27.1`, so a
 * newer 1.x that renamed that field would have stopped all five servers at
 * startup. Now they go into `registerTool(name, config, cb)` through
 * `createToolRegistrar()` in each package's `tool-surface.mjs`. This file keeps
 * the private field out of the source and checks that the registrar still
 * refuses a tool that is missing from, or absent in, SURFACE.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = readdirSync(join(ROOT, 'packages')).filter((name) => name.startsWith('yandex-'));

function sourceFiles(pkg) {
  const dir = join(ROOT, 'packages', pkg, 'src');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(dir, name));
}

/** Strip comments so prose about the old approach does not count as a use. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Stand-in for McpServer that records what reaches the public registerTool(). */
function fakeServer() {
  const calls = [];
  return {
    calls,
    registerTool(name, config, cb) {
      calls.push({ name, config, cb });
      return { name };
    },
  };
}

test('five server packages are checked', () => {
  assert.equal(PACKAGES.length, 5);
});

for (const pkg of PACKAGES) {
  test(`${pkg}: source never touches private SDK fields`, () => {
    for (const file of sourceFiles(pkg)) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!text.includes('_registeredTools'), `${file} mentions _registeredTools`);
      assert.doesNotMatch(code(text), /server\._[A-Za-z]/, `${file} reads a private server field`);
    }
  });

  test(`${pkg}: index.mjs registers every tool through the registrar`, () => {
    const text = code(readFileSync(join(ROOT, 'packages', pkg, 'src', 'index.mjs'), 'utf8'));
    assert.doesNotMatch(text, /server\s*\.\s*(tool|registerTool)\s*\(/, 'direct server.tool/registerTool call');
    assert.match(text, /createToolRegistrar\(server\)/);
    assert.match(text, /registrar\.finish\(\)/);
  });

  test(`${pkg}: registrar passes description and annotations to registerTool`, async () => {
    const { createToolRegistrar } = await import(
      pathToFileURL(join(ROOT, 'packages', pkg, 'src', 'tool-surface.mjs')).href
    );
    const server = fakeServer();
    const registrar = createToolRegistrar(server);
    const handler = async () => ({ content: [] });
    const shape = {};

    // A name that is not in SURFACE stops startup before reaching the SDK.
    assert.throws(() => registrar.tool('no-such-tool', 'Does nothing at all.', shape, handler), /no entry in SURFACE/);
    assert.equal(server.calls.length, 0);

    // Nothing registered yet, so every SURFACE entry is reported as extra.
    assert.throws(() => registrar.finish(), /tool surface mismatch; missing \[\]; extra \[.+\]/);

    // The short form is rejected unless it is exactly (name, description, shape, handler).
    assert.throws(() => registrar.tool('x', 'd', shape, {}, handler), /takes exactly/);
    assert.throws(() => registrar.tool('x', shape, handler), /takes exactly/);
  });
}

test('registrar output: config carries final description and annotations', async () => {
  const { createToolRegistrar } = await import(
    pathToFileURL(join(ROOT, 'packages', 'yandex-search-mcp', 'src', 'tool-surface.mjs')).href
  );
  const server = fakeServer();
  const registrar = createToolRegistrar(server);
  const shape = { query: { fake: true } };
  const handler = async () => ({ content: [] });
  registrar.tool('search', 'Search the web', shape, handler);
  assert.equal(server.calls.length, 1);
  const [{ name, config, cb }] = server.calls;
  assert.equal(name, 'search');
  assert.equal(cb, handler);
  assert.equal(config.inputSchema, shape);
  assert.match(config.description, /^Search the web\. Use when /);
  assert.deepEqual(config.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  registrar.finish();
  // An annotation passed at registration that disagrees with SURFACE is refused.
  assert.throws(
    () =>
      createToolRegistrar(fakeServer()).registerTool(
        'search',
        { description: 'Search the web', annotations: { readOnlyHint: false } },
        handler,
      ),
    /refusing to change readOnlyHint/,
  );
  // Registering it twice is the SDK's call to refuse; the registrar does not hide it.
  assert.throws(
    () =>
      createToolRegistrar({
        registerTool() {
          throw new Error('Tool search is already registered');
        },
      }).tool('search', 'Search the web', shape, handler),
    /already registered/,
  );
});
