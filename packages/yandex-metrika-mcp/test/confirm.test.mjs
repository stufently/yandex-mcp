import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeleteCounterHandler, deleteCounterRefusal, isConfirmed } from '../src/confirm.mjs';

/** Deleter that fails the test if anything reaches it. */
function forbiddenDeleter() {
  const calls = [];
  const fn = async (counterId) => {
    calls.push(counterId);
    throw new Error('the API must not be called without confirmation');
  };
  fn.calls = calls;
  return fn;
}

test('без confirm тул отказывает и НЕ ходит в сеть', async () => {
  const deleter = forbiddenDeleter();
  const handler = createDeleteCounterHandler(deleter);

  const result = await handler({ counter_id: 12345 });

  assert.deepEqual(deleter.calls, [], 'ни одного вызова DELETE не должно быть');
  assert.equal(result.isError, true, 'отказ обязан быть помечен как ошибка вызова');
  assert.equal(result.content[0].type, 'text');
});

test('отказ объясняет необратимость, называет счётчик и что передать', async () => {
  const handler = createDeleteCounterHandler(forbiddenDeleter());
  const text = (await handler({ counter_id: 12345 })).content[0].text;

  assert.match(text, /irreversible/i, 'должен сказать, что операция необратима');
  assert.match(text, /12345/, 'должен назвать счётчик');
  assert.match(text, /confirm: true/, 'должен назвать, что именно передать');
  assert.match(text, /Nothing was sent/i, 'должен сказать, что ничего не произошло');
});

test('confirm: false — такой же отказ, не удаление', async () => {
  const deleter = forbiddenDeleter();
  const handler = createDeleteCounterHandler(deleter);

  const result = await handler({ counter_id: 777, confirm: false });

  assert.deepEqual(deleter.calls, []);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /777/);
});

test('строка "true" не считается подтверждением', async () => {
  const deleter = forbiddenDeleter();
  const handler = createDeleteCounterHandler(deleter);

  const result = await handler({ counter_id: 42, confirm: 'true' });

  assert.deepEqual(deleter.calls, [], 'угаданный тип — не подтверждение');
  assert.equal(result.isError, true);
});

test('с confirm: true удаление проходит ровно один раз', async () => {
  const calls = [];
  const handler = createDeleteCounterHandler(async (counterId) => {
    calls.push(counterId);
    return { success: true };
  });

  const result = await handler({ counter_id: 12345, confirm: true });

  assert.deepEqual(calls, [12345], 'ID должен дойти до DELETE без изменений');
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /12345 deleted successfully/);
  assert.deepEqual(result.structuredContent, { success: true });
});

test('isConfirmed строг к типу', () => {
  assert.equal(isConfirmed(true), true);
  assert.equal(isConfirmed(false), false);
  assert.equal(isConfirmed(undefined), false);
  assert.equal(isConfirmed('true'), false);
  assert.equal(isConfirmed(1), false);
  assert.equal(isConfirmed('yes'), false);
});

test('отказ читаем даже без counter_id', () => {
  const text = deleteCounterRefusal(undefined);
  assert.match(text, /irreversible/i);
  assert.doesNotMatch(text, /undefined/, 'не показывать модели служебное undefined');
});
