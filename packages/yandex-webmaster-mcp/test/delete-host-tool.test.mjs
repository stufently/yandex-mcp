/**
 * Проверка того, что защита действительно ПОДКЛЮЧЕНА к серверу, а не просто
 * лежит отдельным модулем: юнит-тесты `confirm.test.mjs` останутся зелёными,
 * даже если index.mjs перестанет использовать хендлер.
 *
 * Плюс регрессионный забор: новый разрушительный тул без подтверждения обязан
 * уронить этот тест — см. `checkDestructiveSurface`.
 *
 * Сеть не трогаем: токен фиктивный, tools/list в API не ходит.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDestructiveSurface, listTools } from '../../../scripts/lib/list-tools.mjs';

/** Единственная разрушительная операция пакета. */
const DESTRUCTIVE = ['delete-host'];

test('delete-host объявлен разрушительным и просит confirm', async () => {
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'delete-host');
  assert.ok(tool, 'тул delete-host должен быть зарегистрирован');

  assert.equal(tool.annotations?.destructiveHint, true, 'MCP-аннотация destructiveHint обязана быть выставлена');
  assert.equal(tool.annotations?.readOnlyHint, false);
  assert.ok(tool.inputSchema?.required?.includes('host_id'));
  assert.match(tool.description, /IRREVERSIBLE/i, 'описание обязано называть операцию необратимой');
});

test('разрушительная поверхность пакета не расширилась молча', async () => {
  const tools = await listTools('yandex-webmaster-mcp');
  checkDestructiveSurface({
    tools,
    expected: DESTRUCTIVE,
    destructiveNamePattern: /^delete-/,
    assert,
  });
});

test('add-host и add-recrawl-url подтверждения НЕ требуют', async () => {
  const tools = await listTools('yandex-webmaster-mcp');
  // Аддитивные: add-host обратим тем самым delete-host, а add-recrawl-url только
  // ставит URL в очередь переобхода и тратит суточную квоту, которая восстанавливается.
  for (const name of ['add-host', 'add-recrawl-url']) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} должен быть зарегистрирован`);
    assert.notEqual(tool.annotations?.destructiveHint, true, `${name} — аддитивная операция, не разрушительная`);
    assert.ok(!tool.inputSchema?.properties?.confirm, `${name} не должен требовать подтверждения`);
  }
});
