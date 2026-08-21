/**
 * Проверка того, что защита действительно ПОДКЛЮЧЕНА к серверу, а не просто
 * лежит отдельным модулем: юнит-тесты `confirm.test.mjs` останутся зелёными,
 * даже если index.mjs перестанет использовать хендлер.
 *
 * Сеть не трогаем: токен фиктивный, tools/list в API не ходит.
 *
 * Плумбинг подъёма сервера живёт в `scripts/lib/list-tools.mjs` — тем же
 * пользуются smoke-тест и такие же тесты Вебмастера и Директа.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDestructiveSurface, listTools } from '../../../scripts/lib/list-tools.mjs';

/** Единственная разрушительная операция пакета. */
const DESTRUCTIVE = ['delete-counter'];

test('delete-counter объявлен разрушительным и просит confirm', async () => {
  const tools = await listTools('yandex-metrika-mcp');
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
  const tools = await listTools('yandex-metrika-mcp');
  checkDestructiveSurface({
    tools,
    expected: DESTRUCTIVE,
    destructiveNamePattern: /^delete-/,
    assert,
  });
});
