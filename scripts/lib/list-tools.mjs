/**
 * Start one of the servers over stdio, do the MCP handshake and return its
 * `tools/list`.
 *
 * Lives here rather than in a package because it is shared *tooling*, not
 * runtime code: the five packages are published to npm separately and each ships
 * only its own `src/*.mjs`, so no server source file may import across a
 * package boundary — the file would simply be missing from the tarball. Test
 * and script code is never published, so it can and should be shared, and the
 * spawn/JSON-RPC plumbing below was already on its way to a fourth copy.
 *
 * Touches no network: the credentials are fake and `tools/list` never calls an
 * API. That property is what makes it safe to run against Direct, where a real
 * write costs real money.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Credentials every server accepts at startup. Deliberately not usable against any API. */
export const FAKE_ENV = {
  YANDEX_SEARCH_API_KEY: 'smoke',
  YANDEX_FOLDER_ID: 'smoke',
  WORDSTAT_API_KEY: 'smoke',
  WORDSTAT_FOLDER_ID: 'smoke',
  YANDEX_WEBMASTER_TOKEN: 'smoke',
  YANDEX_METRIKA_TOKEN: 'smoke',
  YANDEX_DIRECT_TOKEN: 'smoke',
};

const DEFAULT_TIMEOUT_MS = 30_000;

function request(id, method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

/**
 * @param {string} pkg directory name under `packages/`, e.g. "yandex-direct-mcp"
 * @param {{timeoutMs?: number, clientName?: string}} [options]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listTools(pkg, { timeoutMs = DEFAULT_TIMEOUT_MS, clientName = 'list-tools' } = {}) {
  const child = spawn(process.execPath, [join(ROOT, 'packages', pkg, 'src', 'index.mjs')], {
    env: { ...process.env, ...FAKE_ENV },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => {
    stdout += c;
  });
  child.stderr.on('data', (c) => {
    stderr += c;
  });

  child.stdin.write(
    request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: '0' },
    }),
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(request(2, 'tools/list', {}));

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms; stderr: ${stderr}`)), timeoutMs);
      const finish = (err, value) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value);
      };

      child.on('error', (err) => finish(err));
      child.on('exit', (code) => finish(new Error(`exited early with code ${code}; stderr: ${stderr}`)));

      child.stdout.on('data', () => {
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.id !== 2) continue;
          if (msg.error) finish(new Error(`tools/list failed: ${JSON.stringify(msg.error)}`));
          else finish(null, msg.result?.tools ?? []);
          return;
        }
      });
    });
  } finally {
    child.kill('SIGKILL');
  }
}

/**
 * Assert that a server's destructive surface is exactly what is expected.
 *
 * Two directions, because either one alone leaves a hole:
 *   - every tool flagged `destructiveHint` must be on the list — so a newly
 *     flagged tool has to be considered rather than silently accepted;
 *   - every tool whose NAME says it destroys (`delete…`, `update…`, `set…`)
 *     must be on the list too — so a destructive tool that simply forgot the
 *     annotation cannot slip through, which is the likelier mistake since these
 *     servers register tools through factories.
 * And every tool on the list must actually carry the confirmation, in the shape
 * the refusal path depends on: optional in the schema, named in the description.
 *
 * @param {object} args
 * @param {Array<Record<string, any>>} args.tools result of {@link listTools}
 * @param {string[]} args.expected tool names that are allowed to be destructive
 * @param {RegExp} args.destructiveNamePattern names that must be destructive
 * @param {typeof import('node:assert/strict')} args.assert the caller's assert, so failures point at its test
 */
export function checkDestructiveSurface({ tools, expected, destructiveNamePattern, assert }) {
  const flagged = tools
    .filter((t) => t.annotations?.destructiveHint === true)
    .map((t) => t.name)
    .sort();
  assert.deepEqual(
    flagged,
    [...expected].sort(),
    'набор разрушительных тулов изменился — новый тул нужно закрыть подтверждением',
  );

  const byName = tools
    .filter((t) => destructiveNamePattern.test(t.name))
    .map((t) => t.name)
    .sort();
  assert.deepEqual(
    byName,
    [...expected].sort(),
    'тул с разрушительным именем не помечен destructiveHint (или наоборот) — проверь фабрику регистрации',
  );

  for (const name of expected) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `тул ${name} должен быть зарегистрирован`);
    assert.equal(tool.annotations?.readOnlyHint, false, `${name}: readOnlyHint обязан быть false`);

    const props = tool.inputSchema?.properties ?? {};
    assert.ok(props.confirm, `${name}: в схеме обязан быть параметр confirm`);
    assert.equal(props.confirm.type, 'boolean', `${name}: confirm обязан быть boolean`);

    const required = tool.inputSchema?.required ?? [];
    assert.ok(
      !required.includes('confirm'),
      `${name}: confirm НЕ должен быть required — пропуск обязан давать понятный отказ, а не ошибку валидации схемы`,
    );

    assert.match(tool.description, /confirm: true/, `${name}: описание должно называть требуемое подтверждение`);
  }
}
