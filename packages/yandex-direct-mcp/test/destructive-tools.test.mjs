/**
 * Проверка того, что защита действительно ПОДКЛЮЧЕНА к серверу, а не просто
 * лежит отдельным модулем: юнит-тесты `confirm.test.mjs` останутся зелёными,
 * даже если index.mjs перестанет использовать обёртку.
 *
 * Здесь это особенно важно: тулы Директа заводятся ФАБРИКАМИ, поэтому одна
 * правка фабрики меняет сразу десяток тулов — и никакой юнит-тест этого не
 * увидит. Забор двусторонний (`checkDestructiveSurface`): новый `delete_*`,
 * `update_*` или `set_*` без подтверждения роняет тест, и наоборот — тул,
 * помеченный destructiveHint, обязан быть в списке ниже.
 *
 * Сеть не трогаем: токен фиктивный, tools/list в API не ходит. Для Директа это
 * не формальность — боевая запись здесь тратит настоящие деньги.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDestructiveSurface, listTools } from '../../../scripts/lib/list-tools.mjs';

/**
 * Всё, что нельзя отменить через тот же API:
 *  delete_* — сущность и её статистика теряются навсегда;
 *  update_* — поля перезаписываются, истории ревизий у Директа нет;
 *  set_*    — ставки и корректировки, то есть прямые расходы аккаунта.
 */
const DESTRUCTIVE = [
  'delete_adgroups',
  'delete_ads',
  'delete_bid_modifiers',
  'delete_campaigns',
  'delete_keywords',
  'delete_sitelinks',
  'delete_vcards',
  'set_auto_keyword_bids',
  'set_bid_modifiers',
  'set_keyword_bids',
  'update_adgroups',
  'update_ads',
  'update_campaigns',
  'update_keywords',
];

/** Обратимые: у каждой есть парная операция в этом же сервере. */
const REVERSIBLE = [
  'add_ads',
  'add_adgroups',
  'add_bid_modifiers',
  'add_campaigns',
  'add_keywords',
  'add_sitelinks',
  'add_vcards',
  'archive_adgroups',
  'archive_ads',
  'archive_campaigns',
  'moderate_ads',
  'resume_campaigns',
  'resume_keywords',
  'suspend_campaigns',
  'suspend_keywords',
  'unarchive_adgroups',
  'unarchive_ads',
  'unarchive_campaigns',
];

test('разрушительная поверхность пакета не расширилась молча', async () => {
  const tools = await listTools('yandex-direct-mcp');
  checkDestructiveSurface({
    tools,
    expected: DESTRUCTIVE,
    destructiveNamePattern: /^(delete|update|set)_/,
    assert,
  });
});

test('каждый закрытый тул честно называет необратимость в описании', async () => {
  const tools = await listTools('yandex-direct-mcp');
  for (const name of DESTRUCTIVE) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} должен быть зарегистрирован`);
    assert.match(tool.description, /IRREVERSIBLE/i, `${name}: описание обязано называть операцию необратимой`);
  }
  // Ставки — отдельно: они тратят деньги, и об этом модель должна прочитать до вызова.
  for (const name of ['set_keyword_bids', 'set_auto_keyword_bids', 'set_bid_modifiers']) {
    const tool = tools.find((t) => t.name === name);
    assert.match(tool.description, /SPENDS MONEY/i, `${name}: описание обязано предупреждать о расходе денег`);
  }
});

test('обратимые операции подтверждения НЕ требуют', async () => {
  const tools = await listTools('yandex-direct-mcp');
  for (const name of REVERSIBLE) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} должен быть зарегистрирован`);
    assert.notEqual(tool.annotations?.destructiveHint, true, `${name} обратима парным тулом, а не разрушительна`);
    assert.ok(
      !tool.inputSchema?.properties?.confirm,
      `${name} не должен требовать подтверждения: лишний барьер обесценивает настоящий`,
    );
  }
});
