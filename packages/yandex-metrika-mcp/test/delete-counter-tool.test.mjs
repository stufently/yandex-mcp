/**
 * Проверка того, что защита действительно ПОДКЛЮЧЕНА к серверу, а не просто
 * лежит отдельным модулем: юнит-тесты `confirm.test.mjs` останутся зелёными,
 * даже если index.mjs перестанет использовать хендлер.
 *
 * Сеть не трогаем: токен фиктивный, tools/list в API не ходит.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.mjs');
const TIMEOUT_MS = 30_000;

function rpc(id, method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

async function listTools() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, YANDEX_METRIKA_TOKEN: 'test-token-not-used' },
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
    rpc(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    }),
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(rpc(2, 'tools/list', {}));

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; stderr: ${stderr}`)), TIMEOUT_MS);
      const finish = (err, value) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value);
      };
      child.on('error', finish);
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

test('delete-counter объявлен разрушительным и просит confirm', async () => {
  const tools = await listTools();
  const tool = tools.find((t) => t.name === 'delete-counter');
  assert.ok(tool, 'тул delete-counter должен быть зарегистрирован');

  assert.equal(tool.annotations?.destructiveHint, true, 'MCP-аннотация destructiveHint обязана быть выставлена');
  assert.equal(tool.annotations?.readOnlyHint, false);

  const props = tool.inputSchema?.properties ?? {};
  assert.ok(props.confirm, 'в схеме обязан быть параметр confirm');
  assert.equal(props.confirm.type, 'boolean');

  const required = tool.inputSchema?.required ?? [];
  assert.ok(
    !required.includes('confirm'),
    'confirm НЕ должен быть required в схеме: пропуск обязан давать понятный отказ, а не ошибку валидации',
  );
  assert.ok(required.includes('counter_id'));

  assert.match(tool.description, /confirm: true/, 'описание должно называть требуемое подтверждение');
});

test('прочие тулы этого сервера не помечены разрушительными', async () => {
  const tools = await listTools();
  const destructive = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name);
  assert.deepEqual(destructive, ['delete-counter'], 'единственная разрушительная операция пакета — delete-counter');
});
