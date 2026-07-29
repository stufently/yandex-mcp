import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSeries, formatSeries, formatUrlHistory } from '../src/series.mjs';

test('points-форма (sqi-history) читается', () => {
  const data = { points: [{ date: '2026-07-01T00:00:00.000+03:00', value: 10 }] };
  assert.deepEqual(extractSeries(data), [{ name: null, points: [{ date: '2026-07-01', value: 10 }] }]);
});

test('history-форма (in-search) читается — раньше давала «0 data points»', () => {
  const data = { history: [{ date: '2026-07-20T00:00:00.000+03:00', value: 1256 }] };
  const text = formatSeries('In-search history', data);
  assert.equal(text, 'In-search history: 1 points (latest 1256 on 2026-07-20)');
});

test('indicators-форма разворачивается в ряд на каждый показатель', () => {
  const data = {
    indicators: {
      TOTAL_SHOWS: [
        { date: '2026-07-21T00:00:00.000+03:00', value: 5000 },
        { date: '2026-07-22T00:00:00.000+03:00', value: 5291 },
      ],
      TOTAL_CLICKS: [{ date: '2026-07-22T00:00:00.000+03:00', value: 42 }],
    },
  };
  assert.equal(
    formatSeries('Query history', data),
    'Query history: TOTAL_SHOWS: 2 points (latest 5291 on 2026-07-22) | TOTAL_CLICKS: 1 points (latest 42 on 2026-07-22)',
  );
});

test('пустой и неожиданный ответ не притворяются данными', () => {
  assert.deepEqual(extractSeries(null), []);
  assert.deepEqual(extractSeries({}), []);
  assert.deepEqual(extractSeries({ indicators: [] }), []);
  assert.equal(formatSeries('SQI history', {}), 'SQI history: no data points.');
});

test('пустой ряд внутри indicators не считается отсутствием данных', () => {
  assert.equal(
    formatSeries('Events', { indicators: { APPEARED_IN_SEARCH: [] } }),
    'Events: APPEARED_IN_SEARCH: 0 points',
  );
});

test('история важного URL — не ряд значений, у неё свой формат', () => {
  // Тот же ключ `history`, но записи другой формы: через formatSeries получалось
  // бы «latest undefined on».
  const data = {
    history: [
      {
        url: '54t.ru/page',
        update_date: '2026-02-09T00:00:00.000+03:00',
        change_indicators: ['INDEXING_HTTP_CODE'],
        indexing_status: { status: 'HTTP_2XX', http_code: 200 },
      },
    ],
  };
  assert.equal(
    formatUrlHistory('URL history for https://54t.ru/page', data),
    'URL history for https://54t.ru/page: 1 changes, latest 2026-02-09 (INDEXING_HTTP_CODE), indexing HTTP_2XX.',
  );
  assert.equal(formatUrlHistory('URL history', {}), 'URL history: no changes recorded.');
});

test('нечисловое значение сохраняется как есть, а не превращается в NaN', () => {
  const [series] = extractSeries({ points: [{ date: '2026-07-01', value: 'n/a' }] });
  assert.equal(series.points[0].value, 'n/a');
});
