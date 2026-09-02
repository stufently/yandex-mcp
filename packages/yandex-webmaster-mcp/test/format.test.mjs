import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHostList, formatRecrawlQuota, formatSitemap, formatSummary, orNA } from '../src/format.mjs';

test('ноль — это значение, а не «нет данных»', () => {
  // `value || 'N/A'` ложно-отрицателен ровно на нуле. Боевой прогон 2026-09-02: 14 сайтов
  // с `sqi: 0` показывали «SQI: N/A», хотя structuredContent в том же ответе отдавал 0.
  assert.equal(orNA(0), '0');
  assert.equal(orNA(false), 'false');
  assert.equal(orNA(30), '30');
  assert.equal(orNA(undefined), 'N/A');
  assert.equal(orNA(null), 'N/A');
  assert.equal(orNA(''), 'N/A');
});

test('SQI=0 печатается нулём, а не «N/A»', () => {
  const text = formatSummary({ sqi: 0, searchable_pages_count: 0, excluded_pages_count: 0 });
  assert.match(text, /SQI: 0 \| Searchable: 0 \| Excluded: 0/);
  assert.doesNotMatch(text, /N\/A/, 'ноль — приговор качеству, «N/A» — пробел в данных; это разные ответы');
});

test('отсутствующие счётчики не выдаются за нули', () => {
  // Обратная сторона того же шаблона: `value || 0` печатал ОТСУТСТВИЕ данных нулём,
  // то есть «страниц в поиске нет» вместо «данные не пришли».
  const text = formatSummary({});
  assert.match(text, /SQI: N\/A \| Searchable: N\/A \| Excluded: N\/A/);
  // А вот у степеней проблем пропуск действительно значит ноль: API не присылает
  // степень, по которой проблем нет.
  assert.match(text, /FATAL=0, CRITICAL=0, POSSIBLE=0, RECOMMENDATION=0/);
});

test('сводка не разваливается на мусоре вместо ответа', () => {
  assert.match(formatSummary(undefined), /SQI: N\/A/);
  assert.match(formatSummary({ sqi: 5, site_problems: 'нет' }), /FATAL=0/);
});

test('список хостов отдаёт host_id — идентификатор, нужный всем остальным тулам', () => {
  // Раньше в тексте были только человеческие URL, и формат "https:example.com:443"
  // приходилось угадывать, хотя в structuredContent он лежал всё это время.
  const text = formatHostList([
    { host_id: 'https:example.com:443', unicode_host_url: 'https://example.com/', verified: true },
    { host_id: 'http:пример.рф:80', ascii_host_url: 'http://xn--e1afmkfd.xn--p1ai/', verified: false },
  ]);
  assert.equal(
    text,
    '2 hosts:\n' +
      '- https://example.com/ [verified] host_id: https:example.com:443\n' +
      '- http://xn--e1afmkfd.xn--p1ai/ [unverified] host_id: http:пример.рф:80',
  );
});

test('пустой список хостов и битые записи не роняют вывод', () => {
  assert.equal(formatHostList([]), '0 hosts.');
  assert.equal(formatHostList(undefined), '0 hosts.');
  assert.match(formatHostList([null]), /\(no url\) \[unverified\] host_id: N\/A/);
});

test('пустой sitemap показывается нулём, а не «неизвестно»', () => {
  assert.equal(
    formatSitemap('sm-1', { urls_count: 0, last_check_date: '2026-09-01' }),
    'Sitemap: sm-1\nURLs: 0\nLast checked: 2026-09-01',
  );
  assert.equal(formatSitemap('sm-2', {}), 'Sitemap: sm-2\nURLs: N/A\nLast checked: N/A');
});

test('исчерпанная квота переобхода называется вслух, а не «N/A»', () => {
  // Самый дорогой из трёх случаев: агент видит «N/A» и идёт ставить URL в очередь,
  // которой на сегодня нет.
  const text = formatRecrawlQuota({ daily_quota: 20, quota_remainder: 0 });
  assert.match(text, /Recrawl quota: 20 daily, 0 remaining\./);
  assert.match(text, /Quota is exhausted/);
  assert.doesNotMatch(text, /N\/A/);
});

test('живая квота не пугает пользователя ложным «исчерпана»', () => {
  const text = formatRecrawlQuota({ daily_quota: 20, quota_remainder: 7 });
  assert.match(text, /20 daily, 7 remaining\./);
  assert.doesNotMatch(text, /exhausted/);
  // А неизвестная квота остаётся неизвестной.
  assert.match(formatRecrawlQuota({}), /N\/A daily, N\/A remaining\./);
  assert.doesNotMatch(formatRecrawlQuota({}), /exhausted/);
});
