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
import { readFileSync } from 'node:fs';
import { listTools } from './lib/list-tools.mjs';
import { SERVERS as PACKAGES } from './lib/servers.mjs';

let failed = 0;
let total = 0;
for (const [pkg, minTools] of PACKAGES) {
  try {
    const tools = await listTools(pkg, { clientName: 'smoke' });
    if (tools.length < minTools) {
      console.error(`FAIL ${pkg}: ${tools.length} tools, expected at least ${minTools}`);
      failed++;
    } else {
      console.log(`ok   ${pkg}: ${tools.length} tools`);
    }
    total += tools.length;
  } catch (err) {
    console.error(`FAIL ${pkg}: ${err.message}`);
    failed++;
  }
}

// The plugin listing and README state the tool count; keep them honest.
const claims = [
  ['.claude-plugin/plugin.json', (t) => JSON.parse(t).description],
  ['.claude-plugin/marketplace.json', (t) => JSON.parse(t).plugins[0].description],
  ['README.md', (t) => t],
];
for (const [file, pick] of claims) {
  const text = pick(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  const m = /\b(\d+) tools\b/.exec(text);
  if (!m) {
    console.error(`FAIL ${file}: no "<N> tools" claim found`);
    failed++;
  } else if (Number(m[1]) !== total) {
    console.error(`FAIL ${file}: says ${m[1]} tools, servers expose ${total}`);
    failed++;
  } else {
    console.log(`ok   ${file}: ${total} tools`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed the smoke test.`);
  process.exit(1);
}
console.log('\nAll packages start and expose their tools.');
