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

test('числовые параметры get-excluded-pages целочисленные — дробное значение отбивается схемой', async () => {
  // `z.number()` без `.int()` пропускал 1.5: `max_requests: 1.5` давало ДВА обхода страниц,
  // нарушая заявленный потолок, а дробный offset/limit уходил в API, который объявляет их
  // int32. Отказ даёт схема: `.int()` публикуется как `type: "integer"`, и SDK валидирует
  // аргументы ДО вызова хендлера, поэтому дробное значение до сети не доходит.
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'get-excluded-pages');
  assert.ok(tool, 'тул get-excluded-pages должен быть зарегистрирован');
  for (const name of ['limit', 'offset', 'max_requests']) {
    assert.equal(
      tool.inputSchema?.properties?.[name]?.type,
      'integer',
      `${name}: "number" принял бы дробное значение — потолок обхода перестал бы быть потолком`,
    );
  }
});

test('ни один числовой параметр пакета не объявлен дробным', async () => {
  // Забор на весь пакет, а не на один тул: limit/offset у Яндекса везде int32, и новый
  // тул с `z.number()` без `.int()` обязан уронить этот тест, а не тихо уехать в прод.
  const tools = await listTools('yandex-webmaster-mcp');
  const fractional = [];
  for (const tool of tools) {
    for (const [name, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
      if (schema?.type === 'number') fractional.push(`${tool.name}.${name}`);
    }
  }
  assert.deepEqual(fractional, [], 'числовому параметру нужен .int(): дробное значение уходит в API как есть');
});

test('описание max_requests не выдаёт потолок страниц за потолок HTTP-вызовов', async () => {
  // Один fetchPage внутри ретраится до четырёх раз, но считается за один. Пока описание
  // обещало «cap on API calls», при max_requests=50 реальных запросов могло быть до 200.
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'get-excluded-pages');
  const described = tool.inputSchema?.properties?.max_requests?.description ?? '';
  assert.match(described, /page fetches/i, 'параметр обязан называть то, что считает — страницы');
  assert.match(described, /retries/i, 'и прямо говорить, что ретраи в счёт не идут');
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

test('описание get-excluded-pages не выдаёт ленту событий за текущее состояние', async () => {
  // Тул описывался как «список страниц, исключённых из поиска», а собирался из событий
  // REMOVED_FROM_SEARCH за окно. Боевой замер по hqdthai.ru: 81 URL из выдачи был и в
  // removed, и в appeared — до 29% списка страницы, которые СЕЙЧАС в поиске.
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'get-excluded-pages');
  assert.match(tool.description, /events/i, 'описание обязано называть природу данных — события, а не снимок');
  assert.match(tool.description, /returned_to_search/, 'и называть поле, куда уходят вернувшиеся страницы');
  assert.match(
    tool.description,
    /not expected to match/i,
    'и предупреждать, что агрегат get-summary — число другой природы',
  );
});

test('list-hosts обещает host_id — идентификатор для всех остальных тулов', async () => {
  // Без него формат "https:example.com:443" приходилось угадывать, хотя он есть в ответе.
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'list-hosts');
  assert.match(tool.description, /host_id/);
});

test('get-broken-internal-links предупреждает о возрасте записей', async () => {
  // «189 битых ссылок» читается как авария, хотя живая проверка 258 таких ссылок дала
  // 10 настоящих 404 и ~80% редиректов: Яндекс просто не перечитывал источники с марта.
  const tools = await listTools('yandex-webmaster-mcp');
  const tool = tools.find((t) => t.name === 'get-broken-internal-links');
  assert.match(tool.description, /source_last_access_date/);
  assert.match(tool.description, /stale/i);
});

test('оба тула с исключёнными страницами называют поле причины одинаково', async () => {
  // Описание get-excluded-pages обещало `excluded_url_status`, а structuredContent отдавал
  // `reason`; соседний get-search-events-samples в сырых samples отдавал третий вариант
  // того же значения. Проверка выдачи — в tool-output.test.mjs, здесь витрина.
  const tools = await listTools('yandex-webmaster-mcp');
  for (const name of ['get-excluded-pages', 'get-search-events-samples']) {
    const tool = tools.find((t) => t.name === name);
    assert.match(tool.description, /excluded_url_status/, `${name}: поле причины называется именем из API`);
  }
});
