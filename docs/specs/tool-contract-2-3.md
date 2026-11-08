# Веха: контракт трёх тулов (Вебмастер + Метрика), релиз 2.3.0 — yandex-mcp

- Репозиторий `yandex-mcp` (`~/github/yandex-mcp`, GitHub `stufently/yandex-mcp`), дата 08.11.2026.
- BASE_SHA: `7f22b1b25dd10a7d7d8219d3f0f824f28834c7b8` («Bump gh-pages-site to v1.1.0, add dependabot») —
  `origin/main`, с него снят клон. Поверх него в клоне ОДИН коммит постановщика: эта спека,
  чекер `docs/specs/tool-contract-2-3.check.mjs`.
- Исполнитель: `cx` (Codex). Мутации по новым тестам гоняет Qwen отдельным прогоном.
- Источник: `TASKS.md` репо — три пункта TODO: «Вебмастер: `get-important-url-history`…»,
  «Вебмастер: `add-sitemap` на 409…», «Метрика: семафор под квоту…».
- Критериев: 11.

## Где работать

Одноразовый клон `/home/deploy/exec-clones/ymcp-contract-20261108`, ветка `tool-contract-2-3`
(создана и выбрана). Живое дерево `~/github/yandex-mcp` и соседние клоны не трогать.

- **`git pull` в клоне НЕ делать** (upstream — локальный origin, работа уже на нужной базе).
- **`git push` запрещён — в любой remote.** Работу заберёт постановщик через `git fetch` из клона.
  Теги, `npm publish`, `gh release`, `gh workflow run`, `gh pr` — запрещены.
- Коммиты локальные, `git add` по именам файлов, никогда `-A`/`.`. Можно несколько коммитов.
- Никаких реальных вызовов API Яндекса: токенов нет и не нужно, всё — фикстурами.
- Docker — только с `-u 1002:1002`. На хосте ничего не ставить.

Что положил постановщик: `node_modules/` (untracked, в `.gitignore`), поставлены
`bun install --frozen-lockfile` в `oven/bun:1.4.3-alpine`. На чистом клоне до работы
постановщиком проверено: `node --test` — 212 pass, `bun run lint` — чисто, smoke — зелёный.

## Задача и почему

Три пункта бэклога, все три меняют контракт тула — поэтому minor-релиз 2.3.0 всех пяти
пакетов (версии у пакетов идут в ногу; прошлый релиз — коммит `4074f3a Release 2.2.1`,
повторить его состав файлов).

### (а) `get-important-url-history`: убрать `date_from`/`date_to`

Справочник Вебмастера у `GET /user/{u}/hosts/{h}/important-urls/history` описывает РОВНО
один query-параметр `url` (проверено владельцем по докам 2026-09-01, `TASKS.md`). Тул же
объявляет `date_from`/`date_to` и шлёт их в API впустую. Убрать оба параметра из
`inputSchema` и из запроса (`dateParams` здесь больше не вызывать). Старые вызовы,
передающие даты, НЕ ломаются: SDK зачищает неизвестные ключи (проверено постановщиком:
вызов `get-important-urls` с лишним `foo` проходит без ошибки). Описание тула дополнить:
ресурс отдаёт всю историю отслеживаемой страницы, диапазона дат нет. Обновить таблицу в
`packages/yandex-webmaster-mcp/README.md` (строка `get-important-url-history` — без дат) и
абзац в `packages/yandex-webmaster-mcp/SKILL.md` про «уходят впустую» (теперь параметров нет).

### (б) `add-sitemap`: 409 `SITEMAP_ALREADY_ADDED` — успех со структурой

Справочник «Добавление файла Sitemap»: 201 → `{"sitemap_id": "c7-fe:80-c0"}`; 409 →
`{"error_code": "SITEMAP_ALREADY_ADDED", "sitemap_id": "c7-fe:80-c0", "error_message": "…"}`
(проверено постановщиком по странице справочника 08.11.2026). Сейчас общий
`apiRequestPost` бросает `Error` на любом не-2xx, и `sitemap_id` виден только в тексте.

Сделать (в `packages/yandex-webmaster-mcp/src/index.mjs`):
- `apiRequest`/`apiRequestPost` при не-2xx бросают ошибку с ТЕМ ЖЕ текстом, что сейчас
  (`Webmaster API error (<status>): <первые 500 символов тела>`), но с полями `status`
  (число) и `body` (разобранный JSON тела или `undefined`, если тело не JSON). Поведение
  прочих тулов не меняется (сброс `cachedUserId` на 401/403 — на месте).
- `add-sitemap`: на 409 с `body.error_code === 'SITEMAP_ALREADY_ADDED'` — НЕ ошибка, а результат:
  `structuredContent = { already_present: true, sitemap_id: <из тела или null>, url }`,
  текст называет, что файл уже добавлен, и `sitemap_id`. На успехе (2xx):
  `structuredContent = { ...ответ API, already_present: false, url }` (`sitemap_id` из ответа).
  Любой другой не-2xx (в том числе 409 с иным `error_code`, 404 `HOST_NOT_VERIFIED`) —
  ошибка, как сейчас.
- Описание тула (в `index.mjs`) и `useWhen` (в `tool-surface.mjs`, если нужно) переписать
  под новое поведение; README (абзац под таблицей Sitemaps) и SKILL.md (раздел Sitemap) —
  тоже: повтор больше не ошибка, а `already_present: true`.
- Аннотации тула НЕ менять (их точные значения проверяет `scripts/tool-surface.test.mjs`).

### (в) Метрика: семафор под квоту и ретрай 420

Квоты из справочника «Квотирование» (проверено 08.11.2026): 3 параллельных запроса на
пользователя (все API); 200 запросов за 5 минут на пользователя к API отчётов
(`/stat/v1/data`); 5000 в сутки (сброс в 00:00 GMT); 30 rps с IP. Превышение — 429.
**Предположение:** статус 420 в справочнике не описан; пункт бэклога просит считать его
ретраебельным наравне с 429 — делаем, вреда нет.

Новый модуль `packages/yandex-metrika-mcp/src/http.mjs` (чистые функции, без глобалов),
экспорт ровно с такими именами и семантикой (их проверяет чекер AC-006):

- `METRIKA_MAX_CONCURRENT = 3`, `REPORT_QUOTA_LIMIT = 200`, `REPORT_QUOTA_WINDOW_MS = 300000`.
- `isRetryableStatus(status)` → `true` для 420, 429 и любого `>= 500`; иначе `false`.
- `createSemaphore(max)` → `{ run(fn) }`: `run` вызывает async-`fn`, когда занято меньше `max`
  слотов, возвращает её промис (результат/исключение как есть); слот освобождается и при
  исключении. Очередь ожидающих — FIFO.
- `createSlidingWindow({ limit, windowMs, now = Date.now })` → `{ tryAcquire() }`: если за
  последние `windowMs` записано меньше `limit` отметок — записывает отметку `now()` и
  возвращает `0`; иначе ничего не записывает и возвращает число мс до освобождения самого
  старого слота (`oldest + windowMs - now()`, > 0). Отметка `t` перестаёт считаться, когда
  `now() - t >= windowMs`.
- `createFetchWithRetry({ fetchImpl, sleep, semaphore, reportWindow, isReportUrl, maxRetries = 3 })`
  → `async (url, options) => Response`. Логика ретраев — как у нынешнего `fetchWithRetry`
  в `metrika/src/index.mjs` (сетевые ошибки и ретраебельные статусы; `Retry-After`;
  экспонента 1/2/4 с, потолки 10 с и 30 с; после `maxRetries` повторов — `Error` с текстом
  `API error (<status>) after <maxRetries> retries: …` / `Network error after …`), только
  статус проверяется через `isRetryableStatus`, пауза — через `sleep(ms)`, а КАЖДАЯ попытка:
  1) если `isReportUrl(url)` — сперва `reportWindow.tryAcquire()`; ненулевой ответ → сразу
     `Error`, в тексте которого есть слово `quota`, лимит `200 requests / 5 min` и через
     сколько секунд повторить (округлить вверх); в сеть при этом НЕ ходить;
  2) сам `fetchImpl(url, options)` выполняется внутри `semaphore.run(...)`. Пауза между
     попытками слот НЕ держит.
- `index.mjs` Метрики: удалить локальный `fetchWithRetry`, создать ОДИН экземпляр на процесс:
  `createFetchWithRetry({ fetchImpl: (...a) => fetch(...a), sleep: ms => new Promise(r => setTimeout(r, ms)), semaphore: createSemaphore(METRIKA_MAX_CONCURRENT), reportWindow: createSlidingWindow({ limit: REPORT_QUOTA_LIMIT, windowMs: REPORT_QUOTA_WINDOW_MS }), isReportUrl: u => u.startsWith(STAT_API + '/data') })`
  и звать его везде, где звался старый. `fetch` берётся лениво (через обёртку) — тестовая
  подмена `fetch` грузится раньше сервера.
- Суточную квоту 5000 НЕ вводить (процесс MCP её не переживает, сброс по GMT — 429 от API
  честнее). README Метрики: короткий абзац про локальные ограничения (3 параллельных, 200
  запросов отчётов за 5 минут — отказ без похода в сеть с подсказкой, когда повторить,
  ретраи 420/429/5xx).

### Тесты (новые файлы, стиль — как соседние `*.test.mjs`, `node:test` + `assert/strict`)

- `packages/yandex-webmaster-mcp/test/important-url-history-tool.test.mjs` — схема без дат
  (через `listTools`), вызов со старыми `date_from`/`date_to` не падает и в запрос даты не
  уходят (фикстура `end: true` по `…/important-urls/history?url=<encoded>`).
- `packages/yandex-webmaster-mcp/test/add-sitemap-tool.test.mjs` — через `callTool`: 201,
  409 `SITEMAP_ALREADY_ADDED` (`already_present: true`, `sitemap_id`, `url`, текст с id),
  409 с иным `error_code` — ошибка, 404 `HOST_NOT_VERIFIED` — ошибка, 409 без `sitemap_id`
  в теле — `already_present: true` и `sitemap_id: null`.
- `packages/yandex-metrika-mcp/test/http.test.mjs` — юнит-тесты всего `http.mjs` с
  подменными `fetchImpl`/`sleep`/`now`: каждая ретраебельная граница (420, 429, 500, 499 —
  не ретраится), исчерпание ретраев, `Retry-After`, семафор (пик ровно `max`, FIFO, освобождение
  на исключении, пауза не держит слот), окно (граница `>= windowMs`, счёт только report-URL,
  отказ без сетевого вызова, текст с секундами).
- `packages/yandex-metrika-mcp/test/retry-wiring.test.mjs` — через `callTool`: постоянный 420
  на `/stat/v1/data` у `get-traffic-summary` → ошибка с `after 3 retries` (доказывает, что
  `index.mjs` использует новый модуль; занимает ~7 с, `timeoutMs: 40000`).

### Версия 2.3.0 и учёт

- `version` 2.3.0 во всех пяти `packages/*/package.json`, в `packages/*/server.json` (поле
  `version` и `packages[].version`), в `new McpServer({ …, version })` каждого
  `packages/*/src/index.mjs`, пять workspace-записей в `bun.lock` (НЕ трогать
  `serve-static@2.2.1` — это чужой пакет) и пример пина в корневом `README.md`.
- `CHANGELOG.md`: новая верхняя запись `## 2026-11-08 — 2.3.0: …` с разделами
  Changed/Added/Fixed по трём пунктам; явно отметить смену контракта (даты убраны;
  409 стал успехом; новые локальные отказы Метрики).
- `TASKS.md`: три пункта убрать из TODO, в таблицу `## Completed` добавить строку(и) с датой
  2026-11-08. Остальные пункты не трогать.

## Не трогать

- Аннотации и `inputSchema` прочих тулов; `scripts/lib/*` (фикстурный стаб, `callTool`,
  `listTools`); `scripts/tool-surface.test.mjs`, `scripts/sdk-public-api.test.mjs` и все
  существующие тесты (они обязаны остаться зелёными без правок).
- Пакеты Директа, Wordstat, Search — только строка версии (package.json, server.json,
  McpServer version).
- `.github/`, `Dockerfile`, `mcpb/`, `scripts/build-mcpb.sh`, `.claude-plugin/`, `biome.json`,
  `package.json` корня.
- Исключение: эта спека и чекер `docs/specs/tool-contract-2-3.check.mjs` уже закоммичены
  постановщиком — их не менять.
- Полный список разрешённых к изменению файлов — в AC-011.

## Критерии приёмки

Команды запускаются из корня клона.

- **AC-001.** Полный набор тестов зелёный на Node 22 (как в CI):
  `bash -c 'docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node --test'`
- **AC-002.** Biome-линт чистый (как в CI):
  `bash -c 'docker run --rm -u 1002:1002 -e HOME=/tmp -v "$PWD":/app -w /app oven/bun:1.4.3-alpine bun run lint'`
- **AC-003.** Smoke: все пять серверов стартуют и отдают tools/list:
  `bash -c 'docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node scripts/smoke-tools.mjs'`
- **AC-004.** История важной страницы: схема без дат, старые вызовы не падают, даты не уходят в API:
  `bash -c 'echo "03d242ee881036f71bee30177e3c15862638659de21478e1ec4a0526fe053c9a  docs/specs/tool-contract-2-3.check.mjs" | sha256sum -c - && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node docs/specs/tool-contract-2-3.check.mjs history'`
- **AC-005.** Повторное добавление sitemap — успех со структурой, прочие ошибки остались ошибками:
  `bash -c 'echo "03d242ee881036f71bee30177e3c15862638659de21478e1ec4a0526fe053c9a  docs/specs/tool-contract-2-3.check.mjs" | sha256sum -c - && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node docs/specs/tool-contract-2-3.check.mjs sitemap'`
- **AC-006.** HTTP-модуль Метрики: константы, ретраи 420, семафор, окно отчётов:
  `bash -c 'echo "03d242ee881036f71bee30177e3c15862638659de21478e1ec4a0526fe053c9a  docs/specs/tool-contract-2-3.check.mjs" | sha256sum -c - && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node docs/specs/tool-contract-2-3.check.mjs metrika-http'`
- **AC-007.** Сервер Метрики реально пользуется новым модулем (420 ретраится через живой тул):
  `bash -c 'echo "03d242ee881036f71bee30177e3c15862638659de21478e1ec4a0526fe053c9a  docs/specs/tool-contract-2-3.check.mjs" | sha256sum -c - && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node docs/specs/tool-contract-2-3.check.mjs metrika-wiring'`
- **AC-008.** Версия 2.3.0 везде, CHANGELOG открывается записью 2.3.0:
  `bash -c 'echo "03d242ee881036f71bee30177e3c15862638659de21478e1ec4a0526fe053c9a  docs/specs/tool-contract-2-3.check.mjs" | sha256sum -c - && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node docs/specs/tool-contract-2-3.check.mjs versions'`
- **AC-009.** Три пункта сняты с TODO в TASKS.md:
  `bash -c 'echo "03d242ee881036f71bee30177e3c15862638659de21478e1ec4a0526fe053c9a  docs/specs/tool-contract-2-3.check.mjs" | sha256sum -c - && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node docs/specs/tool-contract-2-3.check.mjs tasks'`
- **AC-010.** Новые тестовые файлы на месте и непустые (не меньше 2/5/12/1 тестов):
  `bash -c 'test "$(grep -c "^test(" packages/yandex-webmaster-mcp/test/important-url-history-tool.test.mjs)" -ge 2 && test "$(grep -c "^test(" packages/yandex-webmaster-mcp/test/add-sitemap-tool.test.mjs)" -ge 5 && test "$(grep -c "^test(" packages/yandex-metrika-mcp/test/http.test.mjs)" -ge 12 && test "$(grep -c "^test(" packages/yandex-metrika-mcp/test/retry-wiring.test.mjs)" -ge 1'`
- **AC-011.** От BASE_SHA изменены только разрешённые файлы, дерево чистое:
  `bash -c 'c="$(git diff --name-only 7f22b1b25dd10a7d7d8219d3f0f824f28834c7b8..HEAD)" && test -z "$(printf "%s\n" "$c" | grep -vxF -e docs/specs/tool-contract-2-3.md -e docs/specs/tool-contract-2-3.check.mjs -e packages/yandex-webmaster-mcp/src/index.mjs -e packages/yandex-webmaster-mcp/src/tool-surface.mjs -e packages/yandex-webmaster-mcp/README.md -e packages/yandex-webmaster-mcp/SKILL.md -e packages/yandex-webmaster-mcp/test/important-url-history-tool.test.mjs -e packages/yandex-webmaster-mcp/test/add-sitemap-tool.test.mjs -e packages/yandex-metrika-mcp/src/index.mjs -e packages/yandex-metrika-mcp/src/http.mjs -e packages/yandex-metrika-mcp/README.md -e packages/yandex-metrika-mcp/test/http.test.mjs -e packages/yandex-metrika-mcp/test/retry-wiring.test.mjs -e packages/yandex-webmaster-mcp/package.json -e packages/yandex-webmaster-mcp/server.json -e packages/yandex-metrika-mcp/package.json -e packages/yandex-metrika-mcp/server.json -e packages/yandex-search-mcp/package.json -e packages/yandex-search-mcp/server.json -e packages/yandex-search-mcp/src/index.mjs -e packages/yandex-wordstat-mcp/package.json -e packages/yandex-wordstat-mcp/server.json -e packages/yandex-wordstat-mcp/src/index.mjs -e packages/yandex-direct-mcp/package.json -e packages/yandex-direct-mcp/server.json -e packages/yandex-direct-mcp/src/index.mjs -e bun.lock -e README.md -e CHANGELOG.md -e TASKS.md)" && test -z "$(git status --porcelain -- . ":(exclude)report.json" ":(exclude)report-blocked.md")"'`

Ожидание на чистом клоне (проверено постановщиком): AC-001…AC-003 и AC-011 — зелёные,
AC-004…AC-010 — красные по своей причине (схема с датами / 409 — ошибка / нет `http.mjs` /
версия 2.2.1 / пункты в TODO / нет файлов).

## Контракт отчёта

`report.json` в КОРНЕ клона, untracked (не коммитить):

```json
{"criteria": [{"id": "AC-001", "status": "pass|fail|blocked",
               "command": "<команда критерия из спеки, посимвольно>", "rc": 0, "note": "…"}]}
```

Записей ровно 11 (AC-001…AC-011). `blocked` — когда среда не даёт выполнить критерий
(нет Docker и т. п.): `"rc": null`, дословная ошибка в `note`. Обходить несовместимость
запрещено (`|| true`, `set +e`, `--no-verify`, `sudo`, `git push` в команде — снятие вехи).
Ревьюеров звать не нужно: ревью и мутации проводит постановщик после приёмки.

## Контракт на невыполнимое

Если требование спеки противоречит коду или другому требованию (например, существующий
тест падает от обязательной правки, SDK не даёт отдать результат нужной формы, чекер
требует невозможного) — **остановись**, ничего не обходи, опиши в `report-blocked.md`
в корне клона (что, где, дословная ошибка, что предлагаешь) и заверши ход. Менять чекер,
спеку, существующие тесты или аннотации ради зелёного запрещено.

## Стыки

- Релиз (тег `v2.3.0` → `publish.yml`/`registry.yml`/`mcpb.yml`/`docker.yml`) делает владелец
  после мержа; эта веха только готовит версию.
- Версия плагина `.claude-plugin/plugin.json` — отдельный пункт `TASKS.md`, здесь не трогается.
