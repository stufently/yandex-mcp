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

test('нечисловой код ответа не превращается в «HTTP NaN»', () => {
  // `typeof NaN === 'number'`, поэтому проверка по typeof пропускала NaN и Infinity —
  // и в ответе появлялся код статуса, которого не существует.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    const pages = selectExcludedPages([
      {
        url: 'https://example.com/x',
        event: 'REMOVED_FROM_SEARCH',
        excluded_url_status: 'HTTP_ERROR',
        bad_http_status: bad,
      },
    ]);
    assert.deepEqual(pages, [{ url: 'https://example.com/x', reason: 'HTTP_ERROR' }]);
    assert.doesNotMatch(formatExcludedPages(pages), /HTTP /);
  }
  // Настоящий код при этом обязан остаться.
  const good = selectExcludedPages([
    {
      url: 'https://example.com/y',
      event: 'REMOVED_FROM_SEARCH',
      excluded_url_status: 'HTTP_ERROR',
      bad_http_status: 503,
    },
  ]);
  assert.equal(good[0].bad_http_status, 503);
  assert.match(formatExcludedPages(good), /HTTP 503/);
});

test('форматтер сам не печатает NaN, даже если запись пришла мимо selectExcludedPages', () => {
  assert.doesNotMatch(
    formatExcludedPages([{ url: 'https://example.com/x', reason: 'HTTP_ERROR', bad_http_status: Number.NaN }]),
    /NaN/,
  );
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
  // Метрика считает СТРАНИЦЫ, а не HTTP-вызовы: ретраи внутри fetchPage обходу не видны.
  // Имя `page_requests` обязано это говорить, иначе цифра читается как число запросов к API.
  assert.equal(result.page_requests, 3);
  assert.equal(result.requests, undefined, 'старое имя обещало потолок HTTP-вызовов, которого нет');
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

test('предел, набранный В СЕРЕДИНЕ страницы, не съедает её хвост', async () => {
  // Регрессия: страница добавлялась в накопитель ЦЕЛИКОМ, курсор двигался на всю её длину,
  // а лишнее отсекалось `slice(0, limit)`. Исключённые страницы из отсечённого хвоста
  // пропадали навсегда: следующий вызов с `offset = next_offset` начинал уже ЗА ними.
  const result = await collectExcludedPages({
    fetchPage: async () => ({
      count: 5,
      samples: Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/${i}`,
        event: 'REMOVED_FROM_SEARCH',
        excluded_url_status: 'LOW_QUALITY',
      })),
    }),
    limit: 2,
    pageSize: 5,
  });
  assert.deepEqual(
    result.pages.map((p) => p.url),
    ['https://example.com/0', 'https://example.com/1'],
  );
  // Курсор обязан указывать на первое НЕПРОЧИТАННОЕ событие, а не за конец страницы.
  assert.equal(result.next_offset, 2);
  // В уже загруженной странице остался непрочитанный хвост — это не конец потока.
  assert.equal(result.exhausted, false);
});

test('два последовательных вызова отдают весь поток без пропусков и дублей', async () => {
  // Тот же дефект с другой стороны: важен не один ответ, а СКЛЕЙКА — клиент продолжает
  // обход с next_offset, и вместе вызовы обязаны покрыть поток ровно один раз.
  // Числа подобраны так, чтобы предел набирался В СЕРЕДИНЕ страницы (12 событий,
  // pageSize 5, limit 2): на границе страницы дефект не проявляется.
  const stream = Array.from({ length: 12 }, (_, i) => ({
    url: `https://example.com/${i}`,
    event: i % 2 === 0 ? 'REMOVED_FROM_SEARCH' : 'APPEARED_IN_SEARCH',
    excluded_url_status: 'DUPLICATE',
  }));
  const fetchPage = async (offset, pageSize) => ({
    count: stream.length,
    samples: stream.slice(offset, offset + pageSize),
  });

  const first = await collectExcludedPages({ fetchPage, limit: 2, pageSize: 5 });
  assert.deepEqual(
    first.pages.map((p) => p.url),
    ['https://example.com/0', 'https://example.com/2'],
  );
  assert.equal(first.exhausted, false);

  const second = await collectExcludedPages({ fetchPage, limit: 2, offset: first.next_offset, pageSize: 5 });
  assert.deepEqual(
    second.pages.map((p) => p.url),
    ['https://example.com/4', 'https://example.com/6'],
  );

  const seen = [...first.pages, ...second.pages].map((p) => p.url);
  assert.equal(new Set(seen).size, seen.length, 'дублей между вызовами быть не должно');
  // Пропусков тоже: между последней страницей первого вызова и первой страницей второго
  // не должно потеряться ни одного исключённого события.
  assert.deepEqual(seen, [
    'https://example.com/0',
    'https://example.com/2',
    'https://example.com/4',
    'https://example.com/6',
  ]);
});

test('обход по кусочкам добирает ровно все исключённые страницы потока', async () => {
  const stream = Array.from({ length: 12 }, (_, i) => ({
    url: `https://example.com/${i}`,
    event: i % 2 === 0 ? 'REMOVED_FROM_SEARCH' : 'APPEARED_IN_SEARCH',
  }));
  const fetchPage = async (offset, pageSize) => ({
    count: stream.length,
    samples: stream.slice(offset, offset + pageSize),
  });

  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const chunk = await collectExcludedPages({ fetchPage, limit: 2, offset, pageSize: 5 });
    seen.push(...chunk.pages.map((p) => p.url));
    offset = chunk.next_offset;
    if (chunk.exhausted) break;
  }
  assert.deepEqual(
    seen,
    [0, 2, 4, 6, 8, 10].map((i) => `https://example.com/${i}`),
  );
});

test('предел, набранный на последнем событии неполной страницы, — это конец потока', async () => {
  // Обратная сторона: непрочитанного хвоста НЕТ и страница неполная, значит соврать
  // «продолжай с next_offset» тоже нельзя — там пусто.
  const result = await collectExcludedPages({
    fetchPage: async () => ({
      count: 3,
      samples: [
        { url: 'https://example.com/a', event: 'REMOVED_FROM_SEARCH' },
        { url: 'https://example.com/b', event: 'APPEARED_IN_SEARCH' },
        { url: 'https://example.com/c', event: 'REMOVED_FROM_SEARCH' },
      ],
    }),
    limit: 2,
    pageSize: 5,
  });
  assert.equal(result.pages.length, 2);
  assert.equal(result.next_offset, 3);
  assert.equal(result.exhausted, true);
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
