import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SCOPES, isReadOnly, resolveScopes, scopeHint, WRITE_SCOPE } from '../src/scopes.mjs';

test('по умолчанию просим и запись — иначе create-counter отвалится 403', () => {
  const scopes = resolveScopes(undefined);
  assert.ok(scopes.includes('metrika:read'));
  assert.ok(scopes.includes(WRITE_SCOPE), 'дефолт обязан включать metrika:write');
  assert.equal(scopes, DEFAULT_SCOPES.join(' '));
});

test('пустая строка не превращается в пустой scope', () => {
  assert.equal(resolveScopes(''), DEFAULT_SCOPES.join(' '));
  assert.equal(resolveScopes('   '), DEFAULT_SCOPES.join(' '));
  assert.equal(resolveScopes(null), DEFAULT_SCOPES.join(' '));
});

test('владелец может осознанно сузить до read-only', () => {
  assert.equal(resolveScopes('metrika:read'), 'metrika:read');
  assert.equal(isReadOnly('metrika:read'), true);
});

test('запятые и пробелы одинаково допустимы, дубли схлопываются', () => {
  assert.equal(resolveScopes('metrika:read,metrika:write'), 'metrika:read metrika:write');
  assert.equal(resolveScopes('metrika:read  metrika:write'), 'metrika:read metrika:write');
  assert.equal(resolveScopes('metrika:read metrika:read'), 'metrika:read');
});

test('isReadOnly видит запись в любом порядке', () => {
  assert.equal(isReadOnly('metrika:write metrika:read'), false);
  assert.equal(isReadOnly(undefined), false, 'дефолт пишущий');
});

test('подсказка появляется только на 403 и называет и скоуп, и тулы', () => {
  const hint = scopeHint(403);
  assert.match(hint, /metrika:write/);
  assert.match(hint, /create-counter/);
  assert.match(hint, /delete-counter/);
  assert.equal(scopeHint(404), '');
  assert.equal(scopeHint(500), '');
  assert.equal(scopeHint(200), '');
});
