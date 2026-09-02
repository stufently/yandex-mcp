/**
 * Проверка ТЕКСТА, который тулы реально отдают клиенту.
 *
 * Юнит-тесты `format.test.mjs` / `links.test.mjs` / `exclusions.test.mjs` проверяют
 * чистые функции и останутся зелёными, даже если `index.mjs` перестанет их звать. Ровно
 * так «SQI: N/A» и дожил до боевого прогона по 18 сайтам. Здесь поднимается настоящий
 * сервер, а сеть подменяется фикстурами: ни одного запроса наружу.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';

const PKG = 'yandex-webmaster-mcp';
const HOST = 'https:example.com:443';
// `end: true` — иначе `/v4/user` перехватил бы и `/v4/user/1/hosts/…`: он его префикс.
const USER = { match: '/v4/user', end: true, body: { user_id: 1 } };

test('get-summary печатает SQI=0 нулём, а не «N/A»', async () => {
  const result = await callTool(PKG, 'get-summary', { host_id: HOST }, [
    USER,
    {
      match: '/summary',
      body: { sqi: 0, searchable_pages_count: 0, excluded_pages_count: 0, site_problems: {} },
    },
  ]);
  const text = textOf(result);
  assert.match(text, /SQI: 0 /);
  assert.doesNotMatch(text, /N\/A/, 'ИКС=0 — приговор качеству, «N/A» — пробел в данных');
  // Текст и structuredContent обязаны говорить одно и то же: расхождение между ними и было
  // симптомом (текст «N/A», структура `"sqi": 0`).
  assert.equal(result.structuredContent.sqi, 0);
});

test('list-hosts показывает host_id в тексте', async () => {
  const result = await callTool(PKG, 'list-hosts', {}, [
    {
      match: '/v4/user/1/hosts',
      body: { hosts: [{ host_id: HOST, unicode_host_url: 'https://example.com/', verified: true }] },
    },
    USER,
  ]);
  assert.match(textOf(result), /host_id: https:example\.com:443/);
});

test('get-recrawl-quota не выдаёт исчерпанную квоту за «неизвестно»', async () => {
  const result = await callTool(PKG, 'get-recrawl-quota', { host_id: HOST }, [
    USER,
    { match: '/recrawl/quota', body: { daily_quota: 20, quota_remainder: 0 } },
  ]);
  const text = textOf(result);
  assert.match(text, /0 remaining/);
  assert.match(text, /Quota is exhausted/);
  assert.doesNotMatch(text, /N\/A/);
});

test('get-broken-internal-links печатает URL и помечает неперепроверенные записи', async () => {
  const result = await callTool(PKG, 'get-broken-internal-links', { host_id: HOST, limit: 2 }, [
    USER,
    {
      match: '/links/internal/broken/samples',
      body: {
        count: 189,
        links: [
          {
            source_url: 'https://example.com/sitemap.xml',
            destination_url: 'https://example.com/faq/1/',
            discovery_date: '2020-03-24',
            source_last_access_date: '2020-03-24',
          },
        ],
      },
    },
  ]);
  const text = textOf(result);
  assert.match(text, /https:\/\/example\.com\/faq\/1\//, 'без URL в тексте чинить нечего');
  assert.match(text, /never re-checked since discovery/);
  assert.match(text, /STALE/);
  assert.match(text, /⚠️ 1 of 1 shown were last checked over 90 days ago/);
  assert.equal(result.structuredContent.links[0].stale, true);
});

test('get-excluded-pages не отдаёт исключённой страницу, вернувшуюся в поиск', async () => {
  // Тот самый дефект боевого прогона, но уже сквозь весь тул: лента идёт свежими вперёд,
  // возврат стоит раньше удаления.
  const result = await callTool(PKG, 'get-excluded-pages', { host_id: HOST, limit: 20 }, [
    USER,
    { match: '/summary', body: { excluded_pages_count: 5 } },
    {
      match: '/search-urls/events/samples',
      body: {
        count: 3,
        samples: [
          { url: 'https://example.com/back', event: 'APPEARED_IN_SEARCH', event_date: '2026-08-27T00:00:00.000+03:00' },
          {
            url: 'https://example.com/gone',
            event: 'REMOVED_FROM_SEARCH',
            excluded_url_status: 'LOW_QUALITY',
            event_date: '2026-08-25T00:00:00.000+03:00',
          },
          {
            url: 'https://example.com/back',
            event: 'REMOVED_FROM_SEARCH',
            excluded_url_status: 'NOT_CANONICAL',
            event_date: '2026-08-20T00:00:00.000+03:00',
          },
        ],
      },
    },
  ]);
  const text = textOf(result);
  assert.deepEqual(
    result.structuredContent.pages.map((page) => page.url),
    ['https://example.com/gone'],
  );
  assert.deepEqual(
    result.structuredContent.returned_to_search.map((entry) => entry.url),
    ['https://example.com/back'],
  );
  // В блоке «Excluded pages» вернувшегося URL быть не должно, а в блоке возвратов — должен.
  const excludedBlock = text.slice(text.indexOf('Excluded pages:'), text.indexOf('Back in search'));
  assert.doesNotMatch(excludedBlock, /example\.com\/back/);
  assert.match(text, /Back in search[\s\S]*example\.com\/back/);
  // И расхождение с агрегатом Яндекса названо вслух.
  assert.equal(result.structuredContent.summary_excluded_pages_count, 5);
  assert.match(text, /excluded_pages_count=5/);
});

test('оба тула отдают причину под ОДНИМ именем — тем, что обещано в описании', async () => {
  // Описание обещало `excluded_url_status`, а в structuredContent лежал `reason`: агент
  // читал описание, шёл за полем и не находил его.
  const events = {
    match: '/search-urls/events/samples',
    body: {
      count: 1,
      samples: [
        {
          url: 'https://example.com/gone',
          event: 'REMOVED_FROM_SEARCH',
          excluded_url_status: 'DUPLICATE',
          event_date: '2026-08-25T00:00:00.000+03:00',
        },
      ],
    },
  };
  const walked = await callTool(PKG, 'get-excluded-pages', { host_id: HOST, limit: 1 }, [
    USER,
    { match: '/summary', body: { excluded_pages_count: 1 } },
    events,
  ]);
  const sampled = await callTool(PKG, 'get-search-events-samples', { host_id: HOST, limit: 1 }, [USER, events]);
  for (const page of [walked.structuredContent.pages[0], sampled.structuredContent.excluded_pages[0]]) {
    assert.equal(page.excluded_url_status, 'DUPLICATE');
    assert.equal(page.reason, undefined, 'синонима больше нет: одно значение — одно имя');
  }
});

test('отказ /summary не роняет get-excluded-pages — справка не данные', async () => {
  const result = await callTool(PKG, 'get-excluded-pages', { host_id: HOST, limit: 20 }, [
    USER,
    { match: '/summary', status: 403, body: { error_message: 'forbidden' } },
    {
      match: '/search-urls/events/samples',
      body: {
        count: 1,
        samples: [{ url: 'https://example.com/gone', event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'NO_INDEX' }],
      },
    },
  ]);
  assert.equal(result.structuredContent.summary_excluded_pages_count, null);
  assert.equal(result.structuredContent.pages.length, 1);
  // Предупреждение о природе данных обязано остаться даже без агрегата.
  assert.match(textOf(result), /REMOVED_FROM_SEARCH events/);
});
