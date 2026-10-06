/**
 * `start-verification` — запуск проверки прав: POST …/verification?verification_type=…
 * БЕЗ тела. Проверяется весь путь через настоящий сервер: метод, query-параметр, пустое
 * тело (фикстура с `method`/`noBody` иначе не сработает и вызов получит 404) и текст.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';
import { listTools } from '../../../scripts/lib/list-tools.mjs';

const PKG = 'yandex-webmaster-mcp';
const HOST = 'https:example.com:443';
const USER = { match: '/v4/user', end: true, body: { user_id: 1 } };

test('start-verification шлёт POST без тела с verification_type в query', async () => {
  const result = await callTool(PKG, 'start-verification', { host_id: HOST, verification_type: 'HTML_FILE' }, [
    USER,
    {
      match: `/v4/user/1/hosts/${HOST}/verification?verification_type=HTML_FILE`,
      end: true,
      method: 'POST',
      noBody: true,
      body: { verification_state: 'IN_PROGRESS', verification_type: 'HTML_FILE', verification_uin: 'abc' },
    },
  ]);
  assert.ok(!result.isError, `вызов не должен падать: ${textOf(result)}`);
  assert.match(textOf(result), /Verification started via HTML_FILE/);
  assert.match(textOf(result), /Verification state: IN_PROGRESS/);
  assert.equal(result.structuredContent.verification_state, 'IN_PROGRESS');
});

test('ошибка API при запуске проверки доходит до клиента текстом', async () => {
  const result = await callTool(PKG, 'start-verification', { host_id: HOST, verification_type: 'DNS' }, [
    USER,
    {
      match: '/verification?verification_type=DNS',
      method: 'POST',
      status: 409,
      body: { error_code: 'VERIFICATION_ALREADY_IN_PROGRESS' },
    },
  ]);
  assert.ok(result.isError, 'ошибка API обязана быть ошибкой вызова');
  assert.match(textOf(result), /409/);
  assert.match(textOf(result), /VERIFICATION_ALREADY_IN_PROGRESS/);
});

test('start-verification: аддитивный писатель с перечислимым способом проверки', async () => {
  const tools = await listTools(PKG);
  const tool = tools.find((t) => t.name === 'start-verification');
  assert.ok(tool, 'тул start-verification должен быть зарегистрирован');
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.readOnlyHint, false);
  assert.deepEqual(tool.inputSchema?.required?.sort(), ['host_id', 'verification_type']);
  assert.deepEqual(tool.inputSchema?.properties?.verification_type?.enum, ['HTML_FILE', 'META_TAG', 'DNS']);
});
