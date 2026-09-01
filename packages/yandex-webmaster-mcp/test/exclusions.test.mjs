import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countExclusionReasons, formatExclusionReasons } from '../src/exclusions.mjs';

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
