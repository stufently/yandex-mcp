import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotateBrokenLinks, daysSince, formatBrokenLinks } from '../src/links.mjs';

const NOW = new Date('2026-09-02T00:00:00.000Z');

test('возраст записи считается в UTC и не зависит от таймзоны процесса', () => {
  assert.equal(daysSince('2026-09-02', NOW), 0);
  assert.equal(daysSince('2026-08-03', NOW), 30);
  assert.equal(daysSince('2026-03-24', NOW), 162);
  // Дата с временем и зоной — берём календарный день.
  assert.equal(daysSince('2026-08-03T23:59:59.000+03:00', NOW), 30);
  // Неизвестный возраст обязан остаться неизвестным, а не превратиться в ноль.
  assert.equal(daysSince(undefined, NOW), null);
  assert.equal(daysSince('', NOW), null);
  assert.equal(daysSince('позавчера', NOW), null);
});

test('запись, которую Яндекс не перепроверял с обнаружения, помечается', () => {
  // У thaifaqs.ru все 189 записей — март 2026 с source_last_access_date == discovery_date.
  // Живая проверка 258 «битых» ссылок (2026-09-02): настоящих 404 — 10, ~80% редиректы.
  const [link] = annotateBrokenLinks(
    [
      {
        source_url: 'https://thaifaqs.ru/sitemap.xml',
        destination_url: 'https://thaifaqs.ru/faq/1/',
        discovery_date: '2026-03-24',
        source_last_access_date: '2026-03-24',
      },
    ],
    { now: NOW },
  );
  assert.equal(link.days_since_last_check, 162);
  assert.equal(link.never_rechecked, true);
  assert.equal(link.stale, true);
  // Исходные поля обязаны дожить до клиента: разметка ДОБАВЛЯЕТ, а не подменяет.
  assert.equal(link.source_url, 'https://thaifaqs.ru/sitemap.xml');
  assert.equal(link.destination_url, 'https://thaifaqs.ru/faq/1/');
});

test('свежая запись не помечается протухшей, а неизвестный возраст — ни тем ни другим', () => {
  const [fresh, unknown] = annotateBrokenLinks(
    [
      { source_url: 's', destination_url: 'd', discovery_date: '2026-08-01', source_last_access_date: '2026-08-30' },
      { source_url: 's2', destination_url: 'd2' },
    ],
    { now: NOW },
  );
  assert.equal(fresh.stale, false);
  assert.equal(fresh.never_rechecked, false);
  assert.equal(unknown.stale, null, 'без даты запись не «свежая» и не «протухшая»');
  assert.equal(unknown.days_since_last_check, null);
});

test('порог протухания настраивается и работает СТРОГО больше', () => {
  const at = annotateBrokenLinks([{ source_last_access_date: '2026-08-03' }], { now: NOW, staleDays: 30 })[0];
  assert.equal(at.stale, false, 'ровно порог — ещё не протухла');
  const over = annotateBrokenLinks([{ source_last_access_date: '2026-08-02' }], { now: NOW, staleDays: 30 })[0];
  assert.equal(over.stale, true);
});

test('текст печатает САМИ ССЫЛКИ, а не только счётчик', () => {
  // Регрессия: текстовый блок был одной строкой «Broken internal links: 50 samples (114 total).»,
  // URL лежали только в structuredContent — модель, читающая текст, видела счётчик и всё.
  const links = annotateBrokenLinks(
    [
      {
        source_url: 'https://example.com/a',
        destination_url: 'https://example.com/gone',
        discovery_date: '2026-08-30',
        source_last_access_date: '2026-08-31',
      },
    ],
    { now: NOW },
  );
  const text = formatBrokenLinks(links, { total: 114 });
  assert.match(text, /Broken internal links: 1 samples \(114 total\)\./);
  assert.match(text, /- https:\/\/example\.com\/gone ← https:\/\/example\.com\/a /);
  assert.match(text, /last checked 2026-08-31 \(2d ago\)/);
  assert.match(text, /found 2026-08-30/);
  assert.doesNotMatch(text, /STALE/);
});

test('старые записи помечены и предупреждение стоит ДО списка', () => {
  const links = annotateBrokenLinks(
    [
      { source_url: 's1', destination_url: 'd1', discovery_date: '2026-03-24', source_last_access_date: '2026-03-24' },
      { source_url: 's2', destination_url: 'd2', discovery_date: '2026-08-30', source_last_access_date: '2026-08-31' },
    ],
    { now: NOW },
  );
  const text = formatBrokenLinks(links, { total: 189 });
  assert.match(text, /⚠️ 1 of 2 shown were last checked over 90 days ago/);
  assert.match(text, /may already be fixed/);
  assert.match(text, /- d1 ← s1 \(last checked 2026-03-24 \(162d ago\), never re-checked since discovery, STALE\)/);
  assert.match(text, /- d2 ← s2 \(last checked 2026-08-31 \(2d ago\), found 2026-08-30\)/);
  assert.ok(text.indexOf('⚠️') < text.indexOf('- d1'), 'предупреждение обязано стоять до списка, а не после');
});

test('пустая выдача не печатает ни предупреждения, ни пустого списка', () => {
  assert.equal(formatBrokenLinks([], { total: 0 }), 'Broken internal links: 0 samples (0 total).');
  assert.equal(formatBrokenLinks(undefined, {}), 'Broken internal links: 0 samples (n/a total).');
});

test('мусор вместо ссылок не роняет разбор', () => {
  assert.deepEqual(annotateBrokenLinks(undefined), []);
  assert.deepEqual(annotateBrokenLinks([null, 'str', 42]), []);
  assert.match(formatBrokenLinks(annotateBrokenLinks([{}], { now: NOW }), {}), /\(no destination\) ← \(no source\)/);
});

test('пустые даты не выдаются за «не перепроверяли»', () => {
  // `'' === ''` тихо давало never_rechecked: true на записи, где дат просто нет.
  const [link] = annotateBrokenLinks(
    [{ source_url: 's', destination_url: 'd', discovery_date: '', source_last_access_date: '' }],
    {
      now: NOW,
    },
  );
  assert.equal(link.never_rechecked, false);
  assert.equal(link.days_since_last_check, null);
  assert.equal(link.stale, null);
});
