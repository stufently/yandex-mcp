import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateParams, endOfDayIso, startOfDayIso, validateDate } from '../src/dates.mjs';

test('date_to покрывает ВЕСЬ последний день, а не его полночь', () => {
  const { date_from, date_to } = dateParams('2026-08-01', '2026-08-21');
  assert.equal(date_from, '2026-08-01T00:00:00.000Z');
  // Регресс: было '2026-08-21T00:00:00.000Z' — последние сутки выпадали целиком.
  assert.equal(date_to, '2026-08-21T23:59:59.999Z');
});

test('однодневный диапазон не схлопывается в пустой', () => {
  const { date_from, date_to } = dateParams('2026-08-21', '2026-08-21');
  assert.ok(new Date(date_to) > new Date(date_from), 'конец дня должен быть позже начала');
  assert.equal(new Date(date_to) - new Date(date_from), 86_399_999);
});

test('границы дня считаются в UTC независимо от таймзоны процесса', () => {
  assert.equal(startOfDayIso('2026-01-01'), '2026-01-01T00:00:00.000Z');
  assert.equal(endOfDayIso('2026-12-31'), '2026-12-31T23:59:59.999Z');
});

test('пропущенные даты не попадают в параметры', () => {
  assert.deepEqual(dateParams(undefined, undefined), {});
  assert.deepEqual(Object.keys(dateParams('2026-08-01', undefined)), ['date_from']);
  assert.deepEqual(Object.keys(dateParams(undefined, '2026-08-01')), ['date_to']);
});

test('перевёрнутый диапазон отбивается до сети', () => {
  assert.throws(() => dateParams('2026-08-21', '2026-08-01'), /is after date_to/);
});

test('битые даты отбиваются до сети', () => {
  assert.throws(() => validateDate('2026-8-1'), /Invalid date format/);
  assert.throws(() => validateDate('2026-02-30'), /Invalid calendar date/);
  assert.throws(() => validateDate('not-a-date'), /Invalid date format/);
});

test('валидная дата возвращается без изменений', () => {
  assert.equal(validateDate('2026-08-21'), '2026-08-21');
  assert.equal(validateDate(undefined), undefined);
});
