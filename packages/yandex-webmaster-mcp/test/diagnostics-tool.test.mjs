/**
 * `get-diagnostics` целиком: настоящий сервер, сеть подменена фикстурой.
 *
 * Юнит-тест форматтера останется зелёным, даже если `index.mjs` перестанет его звать, —
 * поэтому здесь проверяется ТЕКСТ, который тул реально отдаёт модели.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { callTool, textOf } from '../../../scripts/lib/call-tool.mjs';

const PKG = 'yandex-webmaster-mcp';
const HOST = 'https:example.com:443';
const USER = { match: '/v4/user', end: true, body: { user_id: 1 } };
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/diagnostics-not-mobile-friendly.json', import.meta.url)));

test('get-diagnostics показывает NOT_MOBILE_FRIENDLY в тексте, а не только в structuredContent', async () => {
  const result = await callTool(PKG, 'get-diagnostics', { host_id: HOST }, [
    USER,
    { match: '/diagnostics', body: FIXTURE },
  ]);
  const text = textOf(result);
  assert.match(text, /^- NOT_MOBILE_FRIENDLY \[RECOMMENDATION\] since 2026-10-09$/m);
  assert.match(text, /^- NOT_IN_SPRAV \[RECOMMENDATION\] since 2026-09-30$/m);
  assert.match(text, /^Diagnostics: 2 problems present of 33 checks /m);
  assert.doesNotMatch(text, /[{}"]/, 'никакого сырого JSON в тексте');
  assert.deepEqual(result.structuredContent, FIXTURE, 'structuredContent — ответ API без изменений');
});

test('get-diagnostics не режет текст по символам: все 30 длинных PRESENT-записей целиком', async () => {
  const problems = {};
  for (let i = 0; i < 30; i++) {
    problems[`LONG_PROBLEM_${String(i).padStart(2, '0')}_${'Y'.repeat(40)}`] = {
      severity: 'CRITICAL',
      state: 'PRESENT',
      last_state_update: '2026-10-02T00:00:00.000+03:00',
    };
  }
  const result = await callTool(PKG, 'get-diagnostics', { host_id: HOST }, [
    USER,
    { match: '/diagnostics', body: { problems } },
  ]);
  const text = textOf(result);
  for (const code of Object.keys(problems)) {
    assert.ok(
      text.includes(`- ${code} [CRITICAL] since 2026-10-02\n`) ||
        text.endsWith(`- ${code} [CRITICAL] since 2026-10-02`),
      `потерялась запись ${code}`,
    );
  }
});

test('get-diagnostics отдаёт в structuredContent весь ответ API, не только problems', async () => {
  const body = {
    problems: {
      SAMPLE: {
        severity: 'FATAL',
        state: 'PRESENT',
        last_state_update: '2026-10-10T00:00:00.000+03:00',
      },
    },
    server_time: '2026-10-10',
  };
  const result = await callTool(PKG, 'get-diagnostics', { host_id: HOST }, [USER, { match: '/diagnostics', body }]);
  assert.deepEqual(result.structuredContent, body);
});
