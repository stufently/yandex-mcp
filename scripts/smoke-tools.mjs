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
 * Плумбинг вынесен в `lib/list-tools.mjs` — им же пользуются тесты разрушительных тулов.
 */
import { listTools } from './lib/list-tools.mjs';

// Минимум тулов, который сервер обязан отдать. Ловит и «пакет не грузится»,
// и «половина тулов отвалилась при рефакторинге».
const PACKAGES = [
  ['yandex-search-mcp', 1],
  ['yandex-wordstat-mcp', 5],
  ['yandex-webmaster-mcp', 25],
  ['yandex-metrika-mcp', 10],
  ['yandex-direct-mcp', 30],
];

let failed = 0;
for (const [pkg, minTools] of PACKAGES) {
  try {
    const tools = await listTools(pkg, { clientName: 'smoke' });
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
