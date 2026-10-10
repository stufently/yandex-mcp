/**
 * Текст `get-diagnostics`: все проблемы в состоянии PRESENT, без обрезки по символам.
 *
 * Раньше тул печатал `JSON.stringify(problems).substring(0, 500)`. В ответе API 33 записи,
 * почти все ABSENT, и JSON длиной ~3 КБ; PRESENT-записи вроде NOT_MOBILE_FRIENDLY стояли
 * за 500-м символом и в текст не попадали — видны были только в structuredContent.
 * Фикстура — обезличенный боевой ответ /diagnostics (2026-10-10, 33 записи, 2 PRESENT).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatDiagnostics } from '../src/format.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/diagnostics-not-mobile-friendly.json', import.meta.url)));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entryLines(text) {
  return text.split('\n').filter((line) => line.startsWith('- '));
}

function present(code, severity, date = '2026-10-01T10:00:00.000+03:00') {
  return [code, { severity, state: 'PRESENT', last_state_update: date }];
}

test('боевой ответ: обе PRESENT-проблемы в тексте с кодом, степенью и датой', () => {
  const text = formatDiagnostics(FIXTURE);
  assert.match(
    text,
    /^Diagnostics: 2 problems present of 33 checks \(FATAL=0, CRITICAL=0, POSSIBLE_PROBLEM=0, RECOMMENDATION=2\)$/m,
  );
  assert.deepEqual(entryLines(text), [
    '- NOT_IN_SPRAV [RECOMMENDATION] since 2026-09-30',
    '- NOT_MOBILE_FRIENDLY [RECOMMENDATION] since 2026-10-09',
  ]);
  assert.match(text, /^Other states: ABSENT=31$/m);
  assert.doesNotMatch(text, /MAIN_PAGE_ERROR/, 'ABSENT-записи поимённо не печатаются');
  assert.doesNotMatch(text, /[{}"]/, 'никакого сырого JSON в тексте');
});

test('порядок: по степени FATAL → CRITICAL → POSSIBLE_PROBLEM → RECOMMENDATION, внутри — по коду', () => {
  const data = {
    problems: Object.fromEntries([
      present('ZETA_REC', 'RECOMMENDATION'),
      present('B_POSSIBLE', 'POSSIBLE_PROBLEM'),
      present('Z_FATAL', 'FATAL'),
      present('A_POSSIBLE', 'POSSIBLE_PROBLEM'),
      present('M_CRITICAL', 'CRITICAL'),
      present('A_FATAL', 'FATAL'),
    ]),
  };
  const codes = entryLines(formatDiagnostics(data)).map((line) => line.split(' ')[1]);
  assert.deepEqual(codes, ['A_FATAL', 'Z_FATAL', 'M_CRITICAL', 'A_POSSIBLE', 'B_POSSIBLE', 'ZETA_REC']);
  assert.match(
    formatDiagnostics(data),
    /^Diagnostics: 6 problems present of 6 checks \(FATAL=2, CRITICAL=1, POSSIBLE_PROBLEM=2, RECOMMENDATION=1\)$/m,
  );
});

test('неизвестная или пустая степень печатается как есть и идёт после известных', () => {
  const data = {
    problems: {
      B_ODD: { severity: 'WEIRD', state: 'PRESENT', last_state_update: null },
      A_NONE: { state: 'PRESENT', last_state_update: null },
      Z_REC: { severity: 'RECOMMENDATION', state: 'PRESENT', last_state_update: null },
    },
  };
  assert.deepEqual(entryLines(formatDiagnostics(data)), [
    '- Z_REC [RECOMMENDATION] since N/A',
    '- A_NONE [N/A] since N/A',
    '- B_ODD [WEIRD] since N/A',
  ]);
});

test('нет даты — «since N/A», а не пропуск записи', () => {
  const data = { problems: Object.fromEntries([present('NO_DATE', 'CRITICAL', null)]) };
  assert.deepEqual(entryLines(formatDiagnostics(data)), ['- NO_DATE [CRITICAL] since N/A']);
});

test('UNDEFINED и NOT_APPLICABLE считаются в «Other states», но не выдаются за проблемы', () => {
  const data = clone(FIXTURE);
  data.problems.SOFT_404.state = 'UNDEFINED';
  data.problems.THREATS.state = 'NOT_APPLICABLE';
  data.problems.NO_REGIONS.state = 'NOT_APPLICABLE';
  const text = formatDiagnostics(data);
  assert.equal(entryLines(text).length, 2);
  assert.match(text, /^Other states: ABSENT=28, NOT_APPLICABLE=2, UNDEFINED=1$/m);
});

test('длинные коды не режутся по символам: 40 записей — 40 целых строк', () => {
  const entries = [];
  for (let i = 0; i < 40; i++) {
    entries.push(present(`VERY_LONG_PROBLEM_CODE_${String(i).padStart(2, '0')}_${'X'.repeat(60)}`, 'POSSIBLE_PROBLEM'));
  }
  const text = formatDiagnostics({ problems: Object.fromEntries(entries) });
  const lines = entryLines(text);
  assert.equal(lines.length, 40);
  for (const [code] of entries) {
    assert.ok(lines.includes(`- ${code} [POSSIBLE_PROBLEM] since 2026-10-01`), `потерялась запись ${code}`);
  }
  assert.doesNotMatch(text, /more present problems/);
});

test('ровно 50 записей — без пометки «ещё N»', () => {
  const entries = [];
  for (let i = 0; i < 50; i++) entries.push(present(`P_${String(i).padStart(2, '0')}`, 'RECOMMENDATION'));
  const text = formatDiagnostics({ problems: Object.fromEntries(entries) });
  assert.equal(entryLines(text).length, 50);
  assert.doesNotMatch(text, /more present problems/);
});

test('больше 50 записей — обрезка по целым записям с пометкой «ещё N», самые тяжёлые остаются', () => {
  const entries = [];
  for (let i = 0; i < 57; i++) entries.push(present(`A_REC_${String(i).padStart(2, '0')}`, 'RECOMMENDATION'));
  for (let i = 0; i < 3; i++) entries.push(present(`Z_FATAL_${i}`, 'FATAL'));
  const text = formatDiagnostics({ problems: Object.fromEntries(entries) });
  const lines = entryLines(text);
  assert.equal(lines.length, 50);
  assert.deepEqual(lines.slice(0, 3), [
    '- Z_FATAL_0 [FATAL] since 2026-10-01',
    '- Z_FATAL_1 [FATAL] since 2026-10-01',
    '- Z_FATAL_2 [FATAL] since 2026-10-01',
  ]);
  assert.equal(lines[49], '- A_REC_46 [RECOMMENDATION] since 2026-10-01');
  assert.match(text, /^\.\.\. and 10 more present problems \(full list in structuredContent\)$/m);
  assert.match(text, /^Diagnostics: 60 problems present of 60 checks /m);
});

test('ноль PRESENT — заголовок с нулём и ни одной строки-записи', () => {
  const data = clone(FIXTURE);
  data.problems.NOT_IN_SPRAV.state = 'ABSENT';
  data.problems.NOT_MOBILE_FRIENDLY.state = 'ABSENT';
  const text = formatDiagnostics(data);
  assert.match(
    text,
    /^Diagnostics: 0 problems present of 33 checks \(FATAL=0, CRITICAL=0, POSSIBLE_PROBLEM=0, RECOMMENDATION=0\)$/m,
  );
  assert.equal(entryLines(text).length, 0);
  assert.match(text, /^Other states: ABSENT=33$/m);
});

test('нет problems в ответе — «no data», а не ноль проблем', () => {
  for (const data of [undefined, null, {}, { problems: {} }, { problems: 'нет' }]) {
    const text = formatDiagnostics(data);
    assert.match(text, /^Diagnostics: no data \(response has no problems\)\.$/, `вход: ${JSON.stringify(data)}`);
  }
});

test('коды внутри степени сравниваются по кодовым точкам: AA раньше A_B', () => {
  const data = {
    problems: Object.fromEntries([present('A_B', 'FATAL'), present('AA', 'FATAL')]),
  };
  assert.deepEqual(entryLines(formatDiagnostics(data)), [
    '- AA [FATAL] since 2026-10-01',
    '- A_B [FATAL] since 2026-10-01',
  ]);
});

test('строка даты без префикса YYYY-MM-DD печатается целиком', () => {
  const data = {
    problems: Object.fromEntries([present('ODD_DATE', 'FATAL', 'not-a-date-with-extra-text')]),
  };
  assert.deepEqual(entryLines(formatDiagnostics(data)), ['- ODD_DATE [FATAL] since not-a-date-with-extra-text']);
});

test('запись без state считается в Other states как N/A', () => {
  const text = formatDiagnostics({ problems: { NO_STATE: { severity: 'FATAL' } } });
  assert.equal(entryLines(text).length, 0);
  assert.match(text, /^Other states: N\/A=1$/m);
});
