/**
 * Поднять сервер и ВЫЗВАТЬ у него тул, подсунув ответы API фикстурами.
 *
 * Отличие от `listTools`: тот проверяет только витрину (`tools/list`), а тут проходит весь
 * путь — схема, хендлер, форматтер, текстовый блок. Именно эта дыра пропустила «SQI: N/A»
 * в боевой прогон: юнит-тест форматтера остаётся зелёным, даже если `index.mjs` перестал
 * его звать.
 *
 * Сеть не трогается: `fetch` подменяется в дочернем процессе через `--import`
 * (`fetch-stub.mjs`), а креды заведомо нерабочие.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAKE_ENV } from './list-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const STUB = join(HERE, 'fetch-stub.mjs');

const DEFAULT_TIMEOUT_MS = 30_000;

function request(id, method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

/**
 * @param {string} pkg каталог под `packages/`, например "yandex-webmaster-mcp"
 * @param {string} name имя тула
 * @param {Record<string, unknown>} args аргументы вызова
 * @param {{match: string, body?: unknown, status?: number}[]} fixtures ответы вместо сети
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{content: {type: string, text?: string}[], structuredContent?: any}>}
 */
export async function callTool(pkg, name, args, fixtures, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(STUB).href, join(ROOT, 'packages', pkg, 'src', 'index.mjs')],
    {
      env: { ...process.env, ...FAKE_ENV, MCP_FETCH_FIXTURES: JSON.stringify(fixtures) },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.write(
    request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'call-tool', version: '0' },
    }),
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(request(2, 'tools/call', { name, arguments: args }));

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
          if (msg.error) finish(new Error(`tools/call failed: ${JSON.stringify(msg.error)}`));
          else finish(null, msg.result ?? {});
          return;
        }
      });
    });
  } finally {
    child.kill('SIGKILL');
  }
}

/** Склейка текстовых блоков ответа — то, что реально прочитает модель. */
export function textOf(result) {
  return (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
