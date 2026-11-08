/**
 * Чекер вехи tool-contract-2-3 (постановщик). Подкоманда — первый аргумент:
 *   history | sitemap | metrika-http | metrika-wiring | versions | tasks
 * Код возврата 0 — критерий выполнен. Сеть не трогается: fetch подменяется фикстурами.
 * Файл закоммичен постановщиком; исполнителю менять его запрещено.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { callTool, textOf } = await import(pathToFileURL(join(ROOT, 'scripts/lib/call-tool.mjs')).href);
const { listTools } = await import(pathToFileURL(join(ROOT, 'scripts/lib/list-tools.mjs')).href);

const WM = 'yandex-webmaster-mcp';
const HOST = 'https:example.com:443';
const USER = { match: '/v4/user', end: true, body: { user_id: 1 } };
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

async function history() {
  const tools = await listTools(WM);
  const tool = tools.find((t) => t.name === 'get-important-url-history');
  assert.ok(tool, 'get-important-url-history не зарегистрирован');
  assert.deepEqual(Object.keys(tool.inputSchema?.properties ?? {}).sort(), ['host_id', 'url']);
  assert.deepEqual([...(tool.inputSchema?.required ?? [])].sort(), ['host_id', 'url']);
  // Старый вызов с date_from/date_to не должен падать, а даты не должны уходить в API:
  // фикстура совпадает по КОНЦУ адреса, поэтому `?date_from=…&url=…` её не найдёт (404).
  const result = await callTool(
    WM,
    'get-important-url-history',
    { host_id: HOST, url: 'https://example.com/a', date_from: '2026-01-01', date_to: '2026-01-31' },
    [
      USER,
      {
        match: '/important-urls/history?url=https%3A%2F%2Fexample.com%2Fa',
        end: true,
        body: { history: [] },
      },
    ],
  );
  assert.ok(!result.isError, `вызов со старыми датами упал: ${textOf(result)}`);
  assert.doesNotMatch(read('packages/yandex-webmaster-mcp/README.md'), /`get-important-url-history`[^\n]*date_from/);
}

async function sitemap() {
  const post = (status, body) => [USER, { match: '/user-added-sitemaps', method: 'POST', status, body }];
  const dup = await callTool(
    WM,
    'add-sitemap',
    { host_id: HOST, url: 'https://example.com/sitemap.xml' },
    post(409, { error_code: 'SITEMAP_ALREADY_ADDED', sitemap_id: 'c7-fe:80-c0', error_message: 'already' }),
  );
  assert.ok(!dup.isError, `409 SITEMAP_ALREADY_ADDED обязан быть успехом: ${textOf(dup)}`);
  assert.equal(dup.structuredContent?.already_present, true);
  assert.equal(dup.structuredContent?.sitemap_id, 'c7-fe:80-c0');
  assert.equal(dup.structuredContent?.url, 'https://example.com/sitemap.xml');
  assert.match(textOf(dup), /c7-fe:80-c0/);

  const created = await callTool(
    WM,
    'add-sitemap',
    { host_id: HOST, url: 'https://example.com/s2.xml' },
    post(201, { sitemap_id: 'new-1' }),
  );
  assert.ok(!created.isError, textOf(created));
  assert.equal(created.structuredContent?.already_present, false);
  assert.equal(created.structuredContent?.sitemap_id, 'new-1');

  const otherConflict = await callTool(
    WM,
    'add-sitemap',
    { host_id: HOST, url: 'https://example.com/s3.xml' },
    post(409, { error_code: 'SOMETHING_ELSE', error_message: 'x' }),
  );
  assert.ok(otherConflict.isError, 'чужой 409 обязан остаться ошибкой');
  assert.match(textOf(otherConflict), /409/);

  const notVerified = await callTool(
    WM,
    'add-sitemap',
    { host_id: HOST, url: 'https://example.com/s4.xml' },
    post(404, { error_code: 'HOST_NOT_VERIFIED', host_id: HOST }),
  );
  assert.ok(notVerified.isError, '404 обязан остаться ошибкой');
  assert.match(textOf(notVerified), /HOST_NOT_VERIFIED/);
}

async function metrikaHttp() {
  const http = await import(pathToFileURL(join(ROOT, 'packages/yandex-metrika-mcp/src/http.mjs')).href);
  assert.equal(http.METRIKA_MAX_CONCURRENT, 3);
  assert.equal(http.REPORT_QUOTA_LIMIT, 200);
  assert.equal(http.REPORT_QUOTA_WINDOW_MS, 300_000);
  for (const s of [420, 429, 500, 503]) assert.equal(http.isRetryableStatus(s), true, `статус ${s}`);
  for (const s of [200, 400, 401, 403, 404, 409]) assert.equal(http.isRetryableStatus(s), false, `статус ${s}`);

  // Семафор: не больше max одновременно, слот освобождается и при исключении.
  const sem = http.createSemaphore(3);
  let inflight = 0;
  let peak = 0;
  const gates = [];
  const tasks = Array.from({ length: 7 }, (_, i) =>
    sem.run(async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => gates.push(r));
      inflight--;
      return i;
    }),
  );
  while (gates.length < 3) await new Promise((r) => setImmediate(r));
  for (let n = 0; n < 5; n++) await new Promise((r) => setImmediate(r));
  assert.equal(gates.length, 3, 'четвёртая задача стартовала при занятых трёх слотах');
  for (let done = 0; done < 7; done++) {
    while (gates.length === 0) await new Promise((r) => setImmediate(r));
    gates.shift()();
  }
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 3);
  const one = http.createSemaphore(1);
  for (let i = 0; i < 3; i++) await assert.rejects(one.run(async () => Promise.reject(new Error('boom'))));
  assert.equal(await one.run(async () => 'ok'), 'ok');

  // Скользящее окно с подменённым временем.
  let now = 1_000_000;
  const win = http.createSlidingWindow({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(win.tryAcquire(), 0);
  now += 100;
  assert.equal(win.tryAcquire(), 0);
  now += 100;
  assert.equal(win.tryAcquire(), 800, 'ожидание до освобождения самого старого слота');
  now += 800;
  assert.equal(win.tryAcquire(), 0);

  // Ретрай 420 и отказ ретраить 400.
  const sleeps = [];
  const mk = (statuses) => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response('{}', { status: statuses[Math.min(calls.length - 1, statuses.length - 1)] });
    };
    return { calls, fetchImpl };
  };
  const base = {
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    semaphore: http.createSemaphore(3),
    reportWindow: http.createSlidingWindow({ limit: 1000, windowMs: 1000, now: () => 0 }),
    isReportUrl: (u) => u.includes('/stat/v1/data'),
  };
  const a = mk([420, 420, 200]);
  const res = await http.createFetchWithRetry({ ...base, fetchImpl: a.fetchImpl })('https://x/stat/v1/data?a=1', {});
  assert.equal(res.status, 200);
  assert.equal(a.calls.length, 3);
  assert.equal(sleeps.length, 2);
  const b = mk([400]);
  const res400 = await http.createFetchWithRetry({ ...base, fetchImpl: b.fetchImpl })('https://x/management/v1/c', {});
  assert.equal(res400.status, 400);
  assert.equal(b.calls.length, 1);
  const c = mk([420]);
  await assert.rejects(
    http.createFetchWithRetry({ ...base, fetchImpl: c.fetchImpl })('https://x/stat/v1/data', {}),
    /420/,
  );
  assert.equal(c.calls.length, 4, 'maxRetries=3 → 4 попытки');

  // Окно отчётов: исчерпано → отказ БЕЗ сетевого вызова; management в окно не считается.
  const d = mk([200]);
  const tight = http.createFetchWithRetry({
    ...base,
    fetchImpl: d.fetchImpl,
    reportWindow: http.createSlidingWindow({ limit: 1, windowMs: 300_000, now: () => 0 }),
  });
  await tight('https://x/stat/v1/data?q=1', {});
  await tight('https://x/management/v1/counters', {});
  await tight('https://x/management/v1/counters', {});
  await assert.rejects(tight('https://x/stat/v1/data?q=2', {}), /quota/i);
  assert.equal(d.calls.length, 3, 'запрос сверх окна ушёл в сеть');
}

async function metrikaWiring() {
  const result = await callTool(
    'yandex-metrika-mcp',
    'get-traffic-summary',
    { counter_id: 1 },
    [{ match: '/stat/v1/data', status: 420, body: { message: 'quota' } }],
    { timeoutMs: 40_000 },
  );
  assert.ok(result.isError, 'постоянный 420 обязан кончиться ошибкой');
  assert.match(textOf(result), /420/);
  assert.match(textOf(result), /after 3 retries/, '420 не ретраился');
}

function versions() {
  const pkgs = ['search', 'wordstat', 'webmaster', 'metrika', 'direct'].map((n) => `packages/yandex-${n}-mcp`);
  for (const p of pkgs) {
    assert.equal(JSON.parse(read(`${p}/package.json`)).version, '2.3.0', `${p}/package.json`);
    const sj = JSON.parse(read(`${p}/server.json`));
    assert.equal(sj.version, '2.3.0', `${p}/server.json`);
    for (const pk of sj.packages ?? []) assert.equal(pk.version, '2.3.0', `${p}/server.json packages[]`);
    assert.match(read(`${p}/src/index.mjs`), /version: '2\.3\.0'/, `${p} McpServer version`);
    assert.doesNotMatch(read(`${p}/src/index.mjs`), /2\.2\.1/);
  }
  const lock = read('bun.lock');
  assert.equal((lock.match(/"version": "2\.3\.0"/g) ?? []).length, 5, 'bun.lock: пять workspace-версий 2.3.0');
  assert.equal((lock.match(/"version": "2\.2\.1"/g) ?? []).length, 0, 'bun.lock: остались workspace 2.2.1');
  assert.match(read('README.md'), /@stufently\/yandex-webmaster-mcp@2\.3\.0/);
  const cl = read('CHANGELOG.md');
  const firstHeading = cl.split('\n').find((l) => l.startsWith('## '));
  assert.match(firstHeading, /2\.3\.0/, 'верхняя запись CHANGELOG — 2.3.0');
}

function tasks() {
  const t = read('TASKS.md');
  const todo = t.split('## Completed')[0];
  assert.doesNotMatch(todo, /- \[ \] Вебмастер: `get-important-url-history`/);
  assert.doesNotMatch(todo, /- \[ \] Вебмастер: `add-sitemap` на 409/);
  assert.doesNotMatch(todo, /- \[ \] Метрика: семафор/);
  assert.ok(t.includes('## Completed'), 'таблица Completed на месте');
}

const cmds = {
  history,
  sitemap,
  'metrika-http': metrikaHttp,
  'metrika-wiring': metrikaWiring,
  versions,
  tasks,
};
const fn = cmds[process.argv[2]];
if (!fn) {
  console.error(`usage: ${Object.keys(cmds).join('|')}`);
  process.exit(2);
}
try {
  await fn();
  console.log(`OK ${process.argv[2]}`);
} catch (err) {
  console.error(`FAIL ${process.argv[2]}: ${err.stack ?? err}`);
  process.exit(1);
}
