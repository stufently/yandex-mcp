/**
 * Проверка того, что тулы этапа C2 действительно ПОДКЛЮЧЕНЫ к серверу.
 *
 * Юнит-тесты `exclusions.test.mjs` проверяют чистые функции и останутся зелёными,
 * даже если `index.mjs` перестанет их вызывать или тул исчезнет из `tools/list`.
 * Здесь поднимается настоящий сервер (сеть не трогаем: токен фиктивный,
 * `tools/list` в API не ходит).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTools } from '../../../scripts/lib/list-tools.mjs';

test('get-excluded-pages зарегистрирован и обещает причину по каждому URL', async () => {
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'get-excluded-pages');
  assert.ok(tool, 'тул get-excluded-pages должен быть зарегистрирован');
  assert.ok(tool.inputSchema?.required?.includes('host_id'));
  // Обход смешанного потока стоит нескольких HTTP-вызовов — потолок обязан быть
  // управляемым, иначе «дай 100 исключённых» на большом сайте уходит в неизвестность.
  assert.ok(tool.inputSchema?.properties?.max_requests, 'потолок числа запросов должен быть параметром');
  assert.ok(tool.inputSchema?.properties?.offset, 'обход должен продолжаться с next_offset');
  assert.match(tool.description, /excluded_url_status/, 'описание обязано называть поле причины');
});

test('add-sitemap принимает url файла, а не только host_id', async () => {
  // Метод в API v4 ЕСТЬ: POST /user/{user-id}/hosts/{host-id}/user-added-sitemaps
  // с телом {"url": …} (справочник «Добавление файла Sitemap»).
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'add-sitemap');
  assert.ok(tool, 'тул add-sitemap должен быть зарегистрирован');
  assert.ok(tool.inputSchema?.required?.includes('host_id'));
  assert.ok(tool.inputSchema?.required?.includes('url'), 'без URL файла добавлять нечего');
});
