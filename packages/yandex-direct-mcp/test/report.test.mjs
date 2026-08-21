import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDirectError, isRetryableDirectError, isRetrySafeMethod, RETRYABLE_ERROR_CODES } from '../src/errors.mjs';
import { parseTsv } from '../src/report.mjs';

const HEADER = 'CampaignName\tImpressions\tClicks\tCost';

test('кампания с именем "Total ..." больше НЕ выбрасывается из данных', () => {
  const tsv = [HEADER, 'Total Sales Q1\t100\t10\t500', 'Brand\t200\t20\t900'].join('\n');
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].CampaignName, 'Total Sales Q1');
});

test('кампания с именем "Итоговая распродажа" тоже сохраняется', () => {
  const tsv = [HEADER, 'Итоговая распродажа\t5\t1\t50'].join('\n');
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].CampaignName, 'Итоговая распродажа');
});

test('парсер не зависит от языка ответа: ни одна локаль не обрабатывается особо', () => {
  // Сводку глушит skipReportSummary на стороне API. Парсер про язык не знает
  // вообще: строка обрабатывается одинаково, каким бы словом ни начиналась.
  for (const word of ['Total', 'Итого', 'Toplam', 'Разом', 'Brand']) {
    const rows = parseTsv([HEADER, `${word}\t1\t1\t1`].join('\n'));
    assert.equal(rows.length, 1, `строка "${word}" не должна исчезать`);
    assert.equal(rows[0].CampaignName, word);
    assert.deepEqual(Object.keys(rows[0]), ['CampaignName', 'Impressions', 'Clicks', 'Cost']);
  }
});

test('короткая строка НЕ теряется целиком, а добивается пустыми ячейками', () => {
  // Регресс на собственную правку: гвард «меньше колонок — выбросить» создал бы
  // новый канал тихой потери данных вместо старого.
  const tsv = [HEADER, 'Brand\t200'].join('\n');
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { CampaignName: 'Brand', Impressions: '200', Clicks: '', Cost: '' });
});

test('BOM и CRLF не портят первую и последнюю колонки', () => {
  const tsv = `﻿${HEADER}\r\nBrand\t200\t20\t900\r\n`;
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 1);
  assert.ok('CampaignName' in rows[0], 'BOM не должен прилипать к первому заголовку');
  assert.equal(rows[0].Cost, '900', 'CR не должен прилипать к последней колонке');
});

test('пустой ввод не роняет парсер', () => {
  assert.deepEqual(parseTsv(''), []);
  assert.deepEqual(parseTsv('\n\n'), []);
  assert.deepEqual(parseTsv(undefined), []);
});

test('строк не больше лимита', () => {
  const lines = [HEADER];
  for (let i = 0; i < 600; i++) lines.push(`C${i}\t1\t1\t1`);
  assert.equal(parseTsv(lines.join('\n')).length, 500);
  assert.equal(parseTsv(lines.join('\n'), { maxRows: 3 }).length, 3);
});

test('лишние колонки не теряют строку целиком', () => {
  const tsv = [HEADER, 'Brand\t200\t20\t900\textra'].join('\n');
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Cost, '900');
});

test('ретраебельные коды Директа распознаются по числу и по строке', () => {
  for (const code of RETRYABLE_ERROR_CODES) {
    assert.equal(isRetryableDirectError(code), true);
    assert.equal(isRetryableDirectError(String(code)), true);
  }
});

test('постоянные ошибки НЕ ретраятся', () => {
  // 53 — недействительный токен, 54 — нет прав, 152 — кончились баллы.
  for (const code of [53, 54, 152, 8000]) {
    assert.equal(isRetryableDirectError(code), false);
  }
  assert.equal(isRetryableDirectError(undefined), false);
  assert.equal(isRetryableDirectError('abc'), false);
});

test('пишущие методы НЕ ретраятся: таймаут не значит "не применилось"', () => {
  for (const method of ['add', 'update', 'delete', 'suspend', 'resume', 'archive', 'setBids', 'unarchive']) {
    assert.equal(isRetrySafeMethod(method), false, `${method} мутирует боевой аккаунт — повтор запрещён`);
  }
});

test('читающие методы ретраятся', () => {
  assert.equal(isRetrySafeMethod('get'), true);
  assert.equal(isRetrySafeMethod('getBidsRecommendations'), true);
});

test('"get" внутри имени не делает метод читающим', () => {
  // Иначе "forgetAll"/"budgetGet" молча попали бы в повтор.
  assert.equal(isRetrySafeMethod('forgetAll'), false);
  assert.equal(isRetrySafeMethod('budgetGet'), false);
  assert.equal(isRetrySafeMethod('getaway'), false);
  assert.equal(isRetrySafeMethod(undefined), false);
});

test('сообщение об ошибке читаемо и без пустого detail', () => {
  const msg = formatDirectError({ error_code: 53, error_string: 'Invalid token', request_id: 'abc' });
  assert.match(msg, /error 53: Invalid token\./);
  assert.match(msg, /request_id: abc/);
  assert.ok(!msg.includes('.  '), 'без двойного пробела на месте отсутствующего detail');
});
