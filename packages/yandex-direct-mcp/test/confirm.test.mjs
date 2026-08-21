import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeIds, describeItems, destructiveRefusal, isConfirmed, requireConfirmation } from '../src/confirm.mjs';

const SPEC = {
  tool: 'delete_campaigns',
  target: ({ ids }) => describeIds(ids),
  consequence: 'Deleting campaigns is irreversible: they and their accumulated statistics are gone for good.',
  repeat: 'the same ids',
  inspect: 'get_campaigns',
};

/** Performer that fails the test if anything reaches it. */
function forbiddenPerformer() {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    throw new Error('the API must not be called without confirmation');
  };
  fn.calls = calls;
  return fn;
}

test('без confirm тул отказывает и НЕ ходит в сеть', async () => {
  const perform = forbiddenPerformer();
  const handler = requireConfirmation(SPEC, perform);

  const result = await handler({ ids: [12345] });

  assert.deepEqual(perform.calls, [], 'ни одного вызова к Директу быть не должно');
  assert.equal(result.isError, true, 'отказ обязан быть помечен как ошибка вызова');
  assert.equal(result.content[0].type, 'text');
});

test('отказ называет объект, необратимость, деньги-нейтральность и что передать', async () => {
  const handler = requireConfirmation(SPEC, forbiddenPerformer());
  const text = (await handler({ ids: [12345, 777] })).content[0].text;

  assert.match(text, /irreversible/i, 'должен сказать, что операция необратима');
  assert.match(text, /12345, 777/, 'должен назвать затронутые ID');
  assert.match(text, /confirm: true/, 'должен назвать, что именно передать');
  assert.match(text, /Nothing was sent/i, 'должен сказать, что ничего не произошло');
  assert.match(text, /get_campaigns/, 'должен подсказать читающий тул для проверки');
});

test('confirm: false — такой же отказ', async () => {
  const perform = forbiddenPerformer();
  const result = await requireConfirmation(SPEC, perform)({ ids: [777], confirm: false });

  assert.deepEqual(perform.calls, []);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /777/);
});

test('строка "true", 1 и "yes" подтверждением не считаются', async () => {
  for (const guess of ['true', 1, 'yes']) {
    const perform = forbiddenPerformer();
    const result = await requireConfirmation(SPEC, perform)({ ids: [42], confirm: guess });
    assert.deepEqual(perform.calls, [], `угаданный тип ${JSON.stringify(guess)} — не подтверждение`);
    assert.equal(result.isError, true);
  }
});

test('битый JSON без confirm — отказ, а не исключение парсера', async () => {
  const perform = forbiddenPerformer();
  const spec = { ...SPEC, tool: 'update_ads', target: ({ items_json }) => describeItems(items_json) };

  const result = await requireConfirmation(spec, perform)({ items_json: '{not json' });

  assert.deepEqual(perform.calls, [], 'разбор аргументов не должен успевать случиться');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not valid JSON/i);
});

test('с confirm: true операция выполняется ровно один раз и с теми же аргументами', async () => {
  const calls = [];
  const handler = requireConfirmation(SPEC, async (args) => {
    calls.push(args);
    return { content: [{ type: 'text', text: 'done' }] };
  });

  const result = await handler({ ids: [12345], confirm: true });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, [12345], 'ID должны дойти без изменений');
  assert.notEqual(result.isError, true);
});

test('isConfirmed строг к типу', () => {
  assert.equal(isConfirmed(true), true);
  assert.equal(isConfirmed(false), false);
  assert.equal(isConfirmed(undefined), false);
  assert.equal(isConfirmed('true'), false);
  assert.equal(isConfirmed(1), false);
  assert.equal(isConfirmed('yes'), false);
});

test('describeIds не показывает служебный мусор и сокращает длинные списки', () => {
  assert.match(describeIds(undefined), /no IDs given/);
  assert.match(describeIds([]), /no IDs given/);
  assert.match(describeIds([1, 2]), /IDs: 1, 2/);
  const many = describeIds(Array.from({ length: 25 }, (_, i) => i + 1));
  assert.match(many, /25 IDs/);
  assert.match(many, /…/);
});

test('describeItems не бросает ни на каком входе', () => {
  assert.match(describeItems(undefined), /no items given/);
  assert.match(describeItems(''), /no items given/);
  assert.match(describeItems('{oops'), /not valid JSON/i);
  assert.match(describeItems('{"Id":1}'), /not a JSON array/i);
  assert.match(describeItems('[]'), /empty item list/i);
  assert.match(describeItems('[{"Id":11},{"KeywordId":22}]'), /2 items \(IDs: 11, 22\)/);
  assert.match(describeItems('[{"Name":"no id"}]'), /1 item$/);
});

test('отказ читаем без подсказки inspect', () => {
  const text = destructiveRefusal({
    tool: 'set_keyword_bids',
    target: describeItems(undefined),
    consequence: 'Bids decide what the account pays per click.',
    repeat: 'the same bids_json',
  });
  assert.match(text, /set_keyword_bids/);
  assert.doesNotMatch(text, /undefined/, 'не показывать модели служебное undefined');
});
