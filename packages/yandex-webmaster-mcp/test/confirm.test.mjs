import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeleteHostHandler, deleteHostRefusal, isConfirmed } from '../src/confirm.mjs';

const HOST = 'https:example.com:443';

/** Deleter that fails the test if anything reaches it. */
function forbiddenDeleter() {
  const calls = [];
  const fn = async (hostId) => {
    calls.push(hostId);
    throw new Error('the API must not be called without confirmation');
  };
  fn.calls = calls;
  return fn;
}

test('без confirm тул отказывает и НЕ ходит в сеть', async () => {
  const deleter = forbiddenDeleter();
  const handler = createDeleteHostHandler(deleter);

  const result = await handler({ host_id: HOST });

  assert.deepEqual(deleter.calls, [], 'ни одного вызова DELETE не должно быть');
  assert.equal(result.isError, true, 'отказ обязан быть помечен как ошибка вызова');
  assert.equal(result.content[0].type, 'text');
});

test('отказ объясняет необратимость, называет хост и что передать', async () => {
  const handler = createDeleteHostHandler(forbiddenDeleter());
  const text = (await handler({ host_id: HOST })).content[0].text;

  assert.match(text, /irreversible/i, 'должен сказать, что операция необратима');
  assert.match(text, /example\.com/, 'должен назвать хост');
  assert.match(text, /confirm: true/, 'должен назвать, что именно передать');
  assert.match(text, /Nothing was sent/i, 'должен сказать, что ничего не произошло');
});

test('confirm: false — такой же отказ, не удаление', async () => {
  const deleter = forbiddenDeleter();
  const handler = createDeleteHostHandler(deleter);

  const result = await handler({ host_id: HOST, confirm: false });

  assert.deepEqual(deleter.calls, []);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /example\.com/);
});

test('строка "true" не считается подтверждением', async () => {
  const deleter = forbiddenDeleter();
  const handler = createDeleteHostHandler(deleter);

  const result = await handler({ host_id: HOST, confirm: 'true' });

  assert.deepEqual(deleter.calls, [], 'угаданный тип — не подтверждение');
  assert.equal(result.isError, true);
});

test('с confirm: true удаление проходит ровно один раз', async () => {
  const calls = [];
  const handler = createDeleteHostHandler(async (hostId) => {
    calls.push(hostId);
    return undefined;
  });

  const result = await handler({ host_id: HOST, confirm: true });

  assert.deepEqual(calls, [HOST], 'host_id должен дойти до DELETE без изменений');
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /deleted/);
  assert.ok(!('structuredContent' in result), 'пустой ответ 204 не должен превращаться в structuredContent: undefined');
});

test('isConfirmed строг к типу', () => {
  assert.equal(isConfirmed(true), true);
  assert.equal(isConfirmed(false), false);
  assert.equal(isConfirmed(undefined), false);
  assert.equal(isConfirmed('true'), false);
  assert.equal(isConfirmed(1), false);
  assert.equal(isConfirmed('yes'), false);
});

test('отказ читаем даже без host_id', () => {
  const text = deleteHostRefusal(undefined);
  assert.match(text, /irreversible/i);
  assert.doesNotMatch(text, /undefined/, 'не показывать модели служебное undefined');
});
