#!/usr/bin/env node
/**
 * Дымовой тест всех серверов монорепо: поднять по stdio, сделать MCP-хендшейк,
 * запросить tools/list и убедиться, что тулы зарегистрировались.
 *
 * Заменяет прежний шаг CI `node -e "await import(...)" &` — тот уходил в фон
 * и делал джобу зелёной даже когда модуль падал при загрузке (сервер по своей
 * природе не завершается, поэтому «просто импортировать» его нельзя).
 *
 * Сеть не трогаем: креды подставляются фиктивные, tools/list запросов к API не делает.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 30_000;

const FAKE_ENV = {
  YANDEX_SEARCH_API_KEY: 'smoke',
  YANDEX_FOLDER_ID: 'smoke',
  WORDSTAT_API_KEY: 'smoke',
  WORDSTAT_FOLDER_ID: 'smoke',
  YANDEX_WEBMASTER_TOKEN: 'smoke',
  YANDEX_METRIKA_TOKEN: 'smoke',
  YANDEX_DIRECT_TOKEN: 'smoke',
};

// Минимум тулов, который сервер обязан отдать. Ловит и «пакет не грузится»,
// и «половина тулов отвалилась при рефакторинге».
const PACKAGES = [
  ['yandex-search-mcp', 1],
  ['yandex-wordstat-mcp', 5],
  ['yandex-webmaster-mcp', 25],
  ['yandex-metrika-mcp', 10],
  ['yandex-direct-mcp', 30],
];

function request(id, method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

async function listTools(pkg) {
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
      clientInfo: { name: 'smoke', version: '0' },
    }),
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(request(2, 'tools/list', {}));

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms; stderr: ${stderr}`)), TIMEOUT_MS);
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

let failed = 0;
for (const [pkg, minTools] of PACKAGES) {
  try {
    const tools = await listTools(pkg);
    if (tools.length < minTools) {
      console.error(`FAIL ${pkg}: ${tools.length} tools, expected at least ${minTools}`);
      failed++;
    } else {
      console.log(`ok   ${pkg}: ${tools.length} tools`);
    }
  } catch (err) {
    console.error(`FAIL ${pkg}: ${err.message}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} package(s) failed the smoke test.`);
  process.exit(1);
}
console.log('\nAll packages start and expose their tools.');
