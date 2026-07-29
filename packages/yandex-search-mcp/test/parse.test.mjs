import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_RESULT_ERROR_CODES, parseError, parseFound, parseSearchResults } from '../src/parse.mjs';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0">
  <response>
    <found priority="phrase">120</found>
    <found priority="all">9949199</found>
    <found-human>Нашлось 10 млн ответов</found-human>
    <results>
      <grouping>
        <group>
          <doc>
            <url>https://example.com/a</url>
            <title>Заголовок &amp; текст</title>
            <headline>Хедлайн</headline>
            <passages><passage>Первый <hlword>пассаж</hlword></passage></passages>
            <size>4096</size>
            <lang>ru</lang>
          </doc>
        </group>
        <group>
          <doc>
            <url>https://example.org/b</url>
            <title>Второй</title>
          </doc>
        </group>
      </grouping>
    </results>
  </response>
</yandexsearch>`;

test('общее число найденного берётся из found priority="all", а не из длины страницы', () => {
  assert.deepEqual(parseFound(XML), { total: 9949199, human: 'Нашлось 10 млн ответов' });
});

test('отсутствие found не выдумывает число', () => {
  assert.deepEqual(parseFound('<response></response>'), { total: null, human: '' });
});

test('без priority="all" фразовое число не выдаётся за общее', () => {
  // Иначе <found priority="phrase">120</found> уехал бы в totalResults как «всего найдено».
  assert.deepEqual(parseFound('<response><found priority="phrase">120</found></response>'), {
    total: null,
    human: '',
  });
});

test('результаты разбираются с позициями, доменами и сниппетами', () => {
  const results = parseSearchResults(XML);
  assert.equal(results.length, 2);
  assert.equal(results[0].position, 1);
  assert.equal(results[0].domain, 'example.com');
  assert.equal(results[0].title, 'Заголовок & текст');
  assert.equal(results[0].snippet, 'Хедлайн Первый пассаж');
  assert.equal(results[0].size, 4096);
  assert.equal(results[1].domain, 'example.org');
});

test('блок error разбирается вместе с кодом', () => {
  const xml = '<response><error code="32">Превышено допустимое количество запросов</error></response>';
  assert.deepEqual(parseError(xml), { code: 32, message: 'Превышено допустимое количество запросов' });
});

test('код 15 — это пустая выдача, а квота (32) — настоящая ошибка', () => {
  assert.ok(EMPTY_RESULT_ERROR_CODES.has(15));
  assert.ok(!EMPTY_RESULT_ERROR_CODES.has(32));
  assert.ok(!EMPTY_RESULT_ERROR_CODES.has(33));
});

test('error без кода не роняет разбор', () => {
  assert.deepEqual(parseError('<response><error>Что-то пошло не так</error></response>'), {
    code: null,
    message: 'Что-то пошло не так',
  });
});

test('чистая выдача не считается ошибкой', () => {
  assert.equal(parseError(XML), null);
});
