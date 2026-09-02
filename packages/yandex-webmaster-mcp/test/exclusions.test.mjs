import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectExcludedPages,
  countExclusionReasons,
  formatExcludedPages,
  formatExclusionReasons,
  selectExcludedPages,
} from '../src/exclusions.mjs';

test('причины считаются и сортируются по убыванию частоты', () => {
  const samples = [
    { url: 'a', event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'NOT_CANONICAL' },
    { url: 'b', event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'HTTP_ERROR', bad_http_status: 500 },
    { url: 'c', event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'NOT_CANONICAL' },
    { url: 'd', event: 'APPEARED_IN_SEARCH', excluded_url_status: 'HTTP_ERROR' },
  ];
  assert.deepEqual(countExclusionReasons(samples), [
    { status: 'NOT_CANONICAL', count: 2 },
    { status: 'HTTP_ERROR', count: 1 },
  ]);
});

test('при равной частоте порядок стабилен (по имени), а не случаен', () => {
  const samples = [
    { event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'NO_INDEX' },
    { event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'DUPLICATE' },
  ];
  assert.deepEqual(countExclusionReasons(samples), [
    { status: 'DUPLICATE', count: 1 },
    { status: 'NO_INDEX', count: 1 },
  ]);
});

test('появившаяся страница со статусом в сводку «почему выпали» НЕ попадает', () => {
  // Официальный пример ответа содержит `excluded_url_status` прямо рядом с
  // `event: APPEARED_IN_SEARCH` — это прошлая причина уже вернувшейся страницы.
  // Считать её как исключение значит рисовать выдуманную проблему.
  const samples = [
    { url: 'a', event: 'APPEARED_IN_SEARCH', excluded_url_status: 'NOTHING_FOUND' },
    { url: 'b', event: 'APPEARED_IN_SEARCH' },
    { url: 'c', event: 'REMOVED_FROM_SEARCH', excluded_url_status: '' },
  ];
  assert.deepEqual(countExclusionReasons(samples), []);
  assert.equal(formatExclusionReasons(countExclusionReasons(samples)), '');
});

test('мусор вместо выдачи не роняет разбор', () => {
  assert.deepEqual(countExclusionReasons(undefined), []);
  assert.deepEqual(countExclusionReasons(null), []);
  assert.deepEqual(countExclusionReasons({}), []);
  assert.deepEqual(
    countExclusionReasons([
      null,
      'str',
      42,
      { excluded_url_status: 'NO_INDEX' },
      { event: 'REMOVED_FROM_SEARCH', excluded_url_status: 7 },
    ]),
    [],
  );
});

test('строка сводки читается человеком', () => {
  assert.equal(
    formatExclusionReasons([
      { status: 'LOW_QUALITY', count: 3 },
      { status: 'CLEAN_PARAMS', count: 1 },
    ]),
    '\nExclusion reasons on this page: LOW_QUALITY 3, CLEAN_PARAMS 1',
  );
  assert.equal(formatExclusionReasons([]), '');
  assert.equal(formatExclusionReasons(undefined), '');
});

// --- Список исключённых страниц с причиной по каждой (C2) ---

test('исключённые страницы отдаются списком «URL — причина», а не только числом', () => {
  const samples = [
    {
      url: 'https://example.com/a',
      title: 'A',
      event: 'REMOVED_FROM_SEARCH',
      excluded_url_status: 'HTTP_ERROR',
      bad_http_status: 500,
      event_date: '2026-01-01T00:00:00,000+0300',
      last_access: '2025-12-30T00:00:00,000+0300',
    },
    {
      url: 'https://example.com/b',
      event: 'REMOVED_FROM_SEARCH',
      excluded_url_status: 'NOT_CANONICAL',
      target_url: 'https://example.com/canonical',
    },
  ];
  assert.deepEqual(selectExcludedPages(samples), [
    {
      url: 'https://example.com/a',
      reason: 'HTTP_ERROR',
      title: 'A',
      event_date: '2026-01-01T00:00:00,000+0300',
      last_access: '2025-12-30T00:00:00,000+0300',
      bad_http_status: 500,
    },
    {
      url: 'https://example.com/b',
      reason: 'NOT_CANONICAL',
      target_url: 'https://example.com/canonical',
    },
  ]);
});

test('появившаяся страница в список исключённых не попадает', () => {
  // Тот же капкан, что и у сводки: у APPEARED_IN_SEARCH `excluded_url_status` — причина
  // ПРОШЛОГО исключения уже вернувшейся страницы.
  const pages = selectExcludedPages([
    { url: 'https://example.com/back', event: 'APPEARED_IN_SEARCH', excluded_url_status: 'NOTHING_FOUND' },
  ]);
  assert.deepEqual(pages, []);
});

test('исключённая страница без причины не получает выдуманную', () => {
  const pages = selectExcludedPages([{ url: 'https://example.com/x', event: 'REMOVED_FROM_SEARCH' }]);
  assert.deepEqual(pages, [{ url: 'https://example.com/x', reason: null }]);
  assert.match(formatExcludedPages(pages), /REASON_NOT_REPORTED/);
});

test('запись без url в список не попадает — строку «— причина» некуда чинить', () => {
  assert.deepEqual(selectExcludedPages([{ event: 'REMOVED_FROM_SEARCH', excluded_url_status: 'DUPLICATE' }]), []);
  assert.deepEqual(selectExcludedPages(undefined), []);
  assert.deepEqual(selectExcludedPages([null, 'str', 42]), []);
});

test('строка списка показывает причину и уточнения', () => {
  assert.equal(
    formatExcludedPages([
      { url: 'https://example.com/a', reason: 'HTTP_ERROR', bad_http_status: 503 },
      { url: 'https://example.com/b', reason: 'DUPLICATE', target_url: 'https://example.com/orig' },
      { url: 'https://example.com/c', reason: 'LOW_QUALITY' },
    ]),
    '\nExcluded pages:\n' +
      '- https://example.com/a — HTTP_ERROR (HTTP 503)\n' +
      '- https://example.com/b — DUPLICATE (→ https://example.com/orig)\n' +
      '- https://example.com/c — LOW_QUALITY',
  );
  assert.equal(formatExcludedPages([]), '');
  assert.equal(formatExcludedPages(undefined), '');
});

test('обход добирает заказанное число исключённых из смешанного потока', async () => {
  // Серверного фильтра нет: на странице вперемешку оба типа событий. Один вызов с limit=3
  // вернул бы 3 СОБЫТИЯ, из которых исключённых могло быть ноль.
  const page = (n, offset) =>
    Array.from({ length: n }, (_, i) => ({
      url: `https://example.com/${offset + i}`,
      event: (offset + i) % 2 === 0 ? 'APPEARED_IN_SEARCH' : 'REMOVED_FROM_SEARCH',
      excluded_url_status: 'LOW_QUALITY',
    }));
  const calls = [];
  const result = await collectExcludedPages({
    fetchPage: async (offset, pageSize) => {
      calls.push({ offset, pageSize });
      return { count: 1000, samples: page(pageSize, offset) };
    },
    limit: 60,
    pageSize: 10,
    maxRequests: 20,
  });
  assert.equal(result.pages.length, 60);
  assert.equal(calls.length, 12);
  assert.deepEqual(calls[0], { offset: 0, pageSize: 10 });
  assert.deepEqual(calls[1], { offset: 10, pageSize: 10 });
  assert.equal(result.scanned_events, 120);
  assert.equal(result.next_offset, 120);
  assert.equal(result.exhausted, false);
  assert.equal(result.total_events_both_types, 1000);
});

test('неполная страница означает конец потока, а не ещё один запрос', async () => {
  let calls = 0;
  const result = await collectExcludedPages({
    fetchPage: async () => {
      calls += 1;
      return { count: 3, samples: [{ url: 'https://example.com/a', event: 'REMOVED_FROM_SEARCH' }] };
    },
    limit: 50,
    pageSize: 10,
  });
  assert.equal(calls, 1);
  assert.equal(result.exhausted, true);
  assert.equal(result.pages.length, 1);
});

test('пустая страница не крутит цикл на одном offset', async () => {
  // Курсор двигается на длину страницы, то есть на пустой странице НЕ двигается. Без выхода
  // по неполной странице обход сделал бы maxRequests одинаковых запросов на одном offset.
  // `count` намеренно большой: сторож «дошли до count» здесь сработать не должен, иначе тест
  // проверяет не тот выход и переживает поломку настоящего.
  let calls = 0;
  const result = await collectExcludedPages({
    fetchPage: async () => {
      calls += 1;
      return { count: 500, samples: [] };
    },
    limit: 20,
    pageSize: 10,
    maxRequests: 10,
  });
  assert.equal(calls, 1);
  assert.equal(result.exhausted, true);
  assert.deepEqual(result.pages, []);
  assert.equal(result.next_offset, 0);
});

test('потолок запросов останавливает обход и честно говорит, что это не конец', async () => {
  let calls = 0;
  const result = await collectExcludedPages({
    fetchPage: async (offset, pageSize) => {
      calls += 1;
      return {
        count: 100000,
        samples: Array.from({ length: pageSize }, (_, i) => ({
          url: `https://example.com/${offset + i}`,
          event: 'APPEARED_IN_SEARCH',
        })),
      };
    },
    limit: 20,
    pageSize: 10,
    maxRequests: 3,
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.pages, []);
  assert.equal(result.exhausted, false);
  assert.equal(result.next_offset, 30);
});

test('обход не отдаёт больше запрошенного', async () => {
  const result = await collectExcludedPages({
    fetchPage: async (offset, pageSize) => ({
      count: 1000,
      samples: Array.from({ length: pageSize }, (_, i) => ({
        url: `https://example.com/${offset + i}`,
        event: 'REMOVED_FROM_SEARCH',
        excluded_url_status: 'DUPLICATE',
      })),
    }),
    limit: 7,
    pageSize: 10,
  });
  assert.equal(result.pages.length, 7);
});

test('дойдя до count, обход останавливается сам', async () => {
  let calls = 0;
  const result = await collectExcludedPages({
    fetchPage: async (offset, pageSize) => {
      calls += 1;
      return {
        count: 20,
        samples: Array.from({ length: pageSize }, (_, i) => ({
          url: `https://example.com/${offset + i}`,
          event: 'APPEARED_IN_SEARCH',
        })),
      };
    },
    limit: 50,
    pageSize: 10,
    maxRequests: 10,
  });
  assert.equal(calls, 2);
  assert.equal(result.exhausted, true);
  assert.equal(result.next_offset, 20);
});
