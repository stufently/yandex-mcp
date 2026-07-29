import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignDates, DAILY_MAX_AGE_DAYS, formatDate, getDefaultDates, parseDate } from '../src/dates.mjs';

// Среда — чтобы «сегодня» не совпало случайно ни с понедельником, ни с воскресеньем,
// ни с первым/последним днём месяца.
const NOW = new Date('2026-07-29T10:00:00.000Z');
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const ageDays = (iso) => Math.round((Date.UTC(2026, 6, 29) - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);

test('дефолт daily укладывается в лимит API в 60 дней', () => {
  const { fromDate, toDate } = getDefaultDates('daily', NOW);
  assert.ok(ageDays(fromDate) <= DAILY_MAX_AGE_DAYS, `${fromDate} старше ${DAILY_MAX_AGE_DAYS} дней`);
  assert.equal(toDate, '2026-07-28');
});

test('дефолт weekly начинается в понедельник и заканчивается в воскресенье', () => {
  const { fromDate, toDate } = getDefaultDates('weekly', NOW);
  assert.equal(dow(fromDate), 1, `${fromDate} не понедельник`);
  assert.equal(dow(toDate), 0, `${toDate} не воскресенье`);
  assert.equal(toDate, '2026-07-26');
});

test('дефолт monthly — целые месяцы', () => {
  const { fromDate, toDate } = getDefaultDates('monthly', NOW);
  assert.equal(fromDate, '2025-07-01');
  assert.equal(toDate, '2026-06-30');
});

test('дефолт weekly в само воскресенье не берёт незакрытую неделю', () => {
  const { toDate } = getDefaultDates('weekly', new Date('2026-07-26T12:00:00.000Z'));
  assert.equal(toDate, '2026-07-19');
});

test('weekly подтягивает даты к понедельнику и воскресенью', () => {
  // to=пятница 24.07 → воскресенье ЕЁ недели (26.07), а не предыдущее: округление
  // назад выбрасывало целую закрытую неделю, о которой и спрашивали.
  const r = alignDates('weekly', '2026-07-01', '2026-07-24', NOW);
  assert.equal(r.fromDate, '2026-06-29');
  assert.equal(r.toDate, '2026-07-26');
  assert.equal(r.adjustments.length, 2);
});

test('weekly уже выровненные даты не двигает', () => {
  const r = alignDates('weekly', '2026-06-29', '2026-07-19', NOW);
  assert.deepEqual(r.adjustments, []);
});

test('monthly растягивает до целых месяцев', () => {
  const r = alignDates('monthly', '2026-03-15', '2026-06-10', NOW);
  assert.equal(r.fromDate, '2026-03-01');
  assert.equal(r.toDate, '2026-06-30');
});

test('daily прижимает слишком старую дату к границе окна', () => {
  const r = alignDates('daily', '2026-01-01', '2026-07-28', NOW);
  assert.equal(ageDays(r.fromDate), DAILY_MAX_AGE_DAYS);
  assert.match(r.adjustments[0], /last 59 days/);
});

test('daily даты внутри окна проходят как есть', () => {
  const r = alignDates('daily', '2026-07-10', '2026-07-28', NOW);
  assert.deepEqual(r, { fromDate: '2026-07-10', toDate: '2026-07-28', adjustments: [] });
});

test('пустой диапазон — понятная ошибка, а не сырой gRPC', () => {
  assert.throws(() => alignDates('monthly', '2026-06-01', '2026-03-31', NOW), /Empty date range/);
});

test('узкий диапазон внутри одной недели берёт эту неделю целиком', () => {
  // Схлопывание to назад за from дало бы «пустой диапазон» на совершенно нормальном запросе.
  const r = alignDates('weekly', '2026-07-01', '2026-07-03', NOW);
  assert.equal(r.fromDate, '2026-06-29');
  assert.equal(r.toDate, '2026-07-05');
});

test('узкий диапазон внутри одного месяца берёт месяц целиком', () => {
  const r = alignDates('monthly', '2026-06-10', '2026-06-12', NOW);
  assert.equal(r.fromDate, '2026-06-01');
  assert.equal(r.toDate, '2026-06-30');
});

test('незакрытый период не уезжает в API 400, а честно объясняется', () => {
  // Сегодня среда 2026-07-29: неделя 27.07–02.08 и июль ещё не закончились.
  assert.throws(() => alignDates('weekly', '2026-07-27', '2026-07-29', NOW), /has not finished yet/);
  assert.throws(() => alignDates('monthly', '2026-07-05', '2026-07-10', NOW), /has not finished yet/);
});

test('to в текущем периоде прижимается к последнему закрытому', () => {
  const weekly = alignDates('weekly', '2026-06-01', '2026-07-29', NOW);
  assert.equal(weekly.toDate, '2026-07-26');
  const monthly = alignDates('monthly', '2026-01-01', '2026-07-10', NOW);
  assert.equal(monthly.toDate, '2026-06-30');
});

test('daily не запрашивает будущее молча', () => {
  const r = alignDates('daily', '2026-07-20', '2026-08-08', NOW);
  assert.equal(r.toDate, '2026-07-29');
  assert.match(r.adjustments[0], /no data beyond today/);
});

test('битые даты отбиваются до сети', () => {
  assert.throws(() => parseDate('29-07-2026'), /expected YYYY-MM-DD/);
  assert.throws(() => parseDate('2026-02-30'), /not a real calendar date/);
  assert.throws(() => alignDates('daily', '2026-13-01', undefined, NOW), /Invalid fromDate/);
});

test('счёт идёт в UTC независимо от таймзоны процесса', () => {
  // Полночь по Бангкоку (UTC+7) — это ещё предыдущие сутки UTC.
  const bangkokMidnight = new Date('2026-07-29T17:00:00.000Z');
  assert.equal(formatDate(bangkokMidnight), '2026-07-29');
  assert.equal(getDefaultDates('daily', bangkokMidnight).toDate, '2026-07-28');
});
