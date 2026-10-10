# Веха: get-diagnostics без обрезки текста по символам

| | |
|---|---|
| **Репозиторий** | `yandex-mcp` (монорепо), пакет `packages/yandex-webmaster-mcp`, клон `/home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation` |
| **Дата спеки** | 2026-10-10 |
| **Базовый коммит** | BASE_SHA `0f6a954450d2fb4f4bb4913386d7d79307f01731` «Add security policy» |
| **Ветка прогона** | `grok/diag-truncation` |
| **Исполнитель** | `gk` (Grok) — назначен координатором. Мутации по новым тестам потом гоняет противоположный исполнитель (Codex/Spark). |
| **Пакет доказательств** | `report.json` в корне клона + квитанции `review_run.sh` в журнале ревью (см. §10) |

## 1. Где работать

- Клон `/home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation` создан
  постановщиком через `make_clone.sh --kind milestone`. Ветка `grok/diag-truncation`
  отходит от BASE_SHA; на ней уже лежит ОДИН коммит постановщика: эта спека,
  два файла приёмочных тестов и фикстура (см. таблицу ниже). Не переключать ветку,
  не ребейзить, этот коммит не переписывать.
- **Push в origin запрещён** (push-URL и так `no-push`), работу заберёт постановщик
  через `git fetch` из клона. Живое дерево `/home/deploy/github/yandex-mcp` не трогать.
- Что положил постановщик до запуска:

| Путь | Как | Проверка |
|---|---|---|
| `node_modules/`, `packages/*/node_modules/` | `bun install --frozen-lockfile` в Docker (`oven/bun:1`, `-u 1002:1002`), untracked, в `.gitignore` | `test -x node_modules/.bin/biome` |
| `docs/specs/diag-truncation.md` | закоммичено постановщиком | — |
| `packages/yandex-webmaster-mcp/test/diagnostics-format.test.mjs` | закоммичено, sha256 `03ad3fda564f0aa148d19a3483fc1f83470728953eb5872b55acf6e08331f1a8` | AC-004 |
| `packages/yandex-webmaster-mcp/test/diagnostics-tool.test.mjs` | закоммичено, sha256 `db5af7f6c4e48a865dbff2d6898ced53c3830ad314203cee8d8984b5857b3d5f` | AC-004 |
| `packages/yandex-webmaster-mcp/test/fixtures/diagnostics-not-mobile-friendly.json` | закоммичено, sha256 `78adc37d28b74e1b7999cb909023be2052b612c7a58484956f8b21c498c64fda` | AC-004 |

## 2. Задача и почему

Тул `get-diagnostics` (`packages/yandex-webmaster-mcp/src/index.mjs`, строка 313 на
BASE_SHA) отдаёт текстом
`Diagnostics for host: ${JSON.stringify(data.problems || {}).substring(0, 500)}`.
Ответ API `/diagnostics` — объект из 33 записей `{severity, state, last_state_update}`,
почти все `ABSENT`, JSON ~3 КБ. Обрезка на 500-м символе отбрасывает всё, что
дальше: на боевом аудите 134 сайтов (2026-10-10) у трёх сайтов был
`NOT_MOBILE_FRIENDLY` в состоянии `PRESENT` на позиции 1806–2773 символа — в тексте
его не было, только в `structuredContent`. Модель, читающая текст, видит «нет проблем».

Цель: текст ответа содержит ВСЕ проблемы в состоянии `PRESENT` (код, степень, дата)
компактно, без сырого JSON и без обрезки по символам. Лимит — только по целым
записям (50) с явной строкой «ещё N». `structuredContent` не меняется.

## 3. Что проверено вживую, а что предположение

Проверено чтением кода и запуском на BASE_SHA (2026-10-10):

1. `src/index.mjs`: тул `get-diagnostics` (строки 302–318) берёт
   `apiRequest(await hostUrl(host_id, '/diagnostics'))` и возвращает
   `{ content: [{ type: 'text', text: <строка выше> }], structuredContent: data }`.
   Это ЕДИНСТВЕННОЕ место в пакете, где ответ API печатается через
   `JSON.stringify(...).substring(...)`. Остальные `substring(0, 500)` / `(0, 200)` в
   `index.mjs` (строки 60, 81, 128, 154, 1110) — тексты ОШИБОК API, не трогать.
   `get-popular-queries` режет список через `slice(0, 20)`, но с пометкой
   `(showing 20 of N)` — это уже обрезка по записям, не трогать.
2. Общего хелпера обрезки в пакете нет. Форматтеры текста живут в `src/format.mjs`
   (`orNA`, `formatSummary`, `formatHostList`, `formatSitemap`, `formatRecrawlQuota` —
   все `export function`), `index.mjs` импортирует их одной строкой
   `import { formatHostList, formatRecrawlQuota, formatSitemap, formatSummary, orNA } from './format.mjs';`.
   `orNA(v)` → `'N/A'` для `undefined`/`null`/`''`, иначе `String(v)`.
3. В соседних пакетах монорепо того же шаблона (JSON + обрезка по символам) нет:
   `yandex-search-mcp` режет сниппет одного результата до 150 символов,
   `yandex-wordstat-mcp` — списки `slice(0, 20/24)`. Это другие тулы и другой
   приём, в скоуп НЕ входят.
4. Тесты: корень `package.json` → `"test": "node --test"` (находит все `*.test.mjs`).
   Сквозные тесты тулов — через `scripts/lib/call-tool.mjs` (`callTool(pkg, name, args, fixtures)`,
   поднимает настоящий сервер, `fetch` подменён `scripts/lib/fetch-stub.mjs`, сети нет),
   образец — `packages/yandex-webmaster-mcp/test/tool-output.test.mjs`.
5. В Docker `node:22-alpine` (CI тоже на Node 22) `-u 1002:1002`: на BASE_SHA
   166 тестов зелёные; `biome check .` чистый; `node scripts/smoke-tools.mjs` —
   «yandex-webmaster-mcp: 33 tools», все пакеты стартуют.
6. Приёмочные тесты постановщика на BASE_SHA красные по делу:
   `diagnostics-format.test.mjs` — `SyntaxError: ... does not provide an export named 'formatDiagnostics'`;
   `diagnostics-tool.test.mjs` — оба теста падают на своих ассертах (в тексте нет
   `NOT_MOBILE_FRIENDLY`; «потерялась запись LONG_PROBLEM_00_…»).
7. Эталонная реализация постановщика по §4 (не закоммичена, откачена) даёт 178/178
   зелёных — то есть тесты выполнимы одновременно.
8. Фикстура — обезличенный боевой ответ `/diagnostics` одного сайта (без имени хоста):
   33 записи, 31 `ABSENT`, 2 `PRESENT` (`NOT_IN_SPRAV`, `NOT_MOBILE_FRIENDLY`, обе
   `RECOMMENDATION`). Встречающиеся в боевых данных состояния: `ABSENT`, `PRESENT`,
   `NOT_APPLICABLE`, `UNDEFINED`; степени: `FATAL`, `CRITICAL`, `POSSIBLE_PROBLEM`,
   `RECOMMENDATION`; `last_state_update` — ISO-строка или `null`.

Предположения: нет.

## 4. Что сделать

### 4.1. `packages/yandex-webmaster-mcp/src/format.mjs`

Добавить `export function formatDiagnostics(data)` (с JSDoc в стиле файла: зачем —
обрезка по символам прятала PRESENT-проблемы). Поведение — ровно то, что требуют
приёмочные тесты; словами:

1. `problems` = `data.problems`, если `data` — объект и `problems` — объект. Иначе или
   если записей 0 → единственная строка
   `Diagnostics: no data (response has no problems).`
2. Первая строка:
   `Diagnostics: <P> problems present of <T> checks (FATAL=<a>, CRITICAL=<b>, POSSIBLE_PROBLEM=<c>, RECOMMENDATION=<d>)`,
   где `T` — всего записей, `P` — записей со `state === 'PRESENT'`, счётчики — PRESENT по
   четырём известным степеням (запись с иной степенью в счётчики не входит, но в `P` входит).
3. Затем по строке на каждую PRESENT-запись:
   `- <CODE> [<severity через orNA>] since <дата>`, где дата — первые 10 символов
   `last_state_update`, если это строка, начинающаяся с `YYYY-MM-DD`, иначе `orNA(значение)`.
   Порядок: степень FATAL → CRITICAL → POSSIBLE_PROBLEM → RECOMMENDATION → любые прочие
   (включая отсутствующую), внутри одной группы — по коду, сравнение строк по кодовым
   точкам (`<`/`>`, не `localeCompare`).
4. Лимит 50 строк-записей (константа модуля). Больше 50 → первые 50 в этом порядке и
   строка `... and <N> more present problems (full list in structuredContent)`.
   Ровно 50 — без этой строки. Обрезки по символам нет нигде.
5. Последняя строка, если есть не-PRESENT записи:
   `Other states: <STATE>=<n>, ...` — состояния, отсортированные по имени; отсутствующее
   состояние считается как `orNA(state)`. Не-PRESENT записи поимённо не печатаются.
6. Строки склеиваются `\n`. Никакого `JSON.stringify` в тексте.

### 4.2. `packages/yandex-webmaster-mcp/src/index.mjs`

- Импорт `formatDiagnostics` в существующую строку импорта из `./format.mjs`.
- В `get-diagnostics` текст = `formatDiagnostics(data)`; `structuredContent: data`
  без изменений. Описание тула можно уточнить (например, что текст перечисляет
  проблемы в состоянии PRESENT), имя и схему аргументов не менять.
- Больше ничего в `index.mjs` не менять.

### 4.3. Документация

- `CHANGELOG.md` (корень) — новый верхний раздел `## 2026-10-10 — ...` в стиле
  файла: `### Fixed` — `get-diagnostics` больше не режет текст на 500 символах, перечисляет
  все PRESENT-проблемы, лимит 50 записей с «ещё N».
- `packages/yandex-webmaster-mcp/SKILL.md` — в пункте 1 раздела «Регулярный аудит»
  одно-два предложения: текст `get-diagnostics` перечисляет только PRESENT-проблемы
  (код, степень, дата), остальные состояния — счётчиком `Other states`; полный ответ —
  в `structuredContent`. Больше ничего в `SKILL.md` не менять.

## 5. Не трогать

- Приёмочные тесты и фикстуру из §1 — ни байта (их sha256 сверяет AC-004).
  Новых тестовых файлов не создавать: покрытие вехи задают приёмочные тесты.
- Остальные тулы, `apiRequest`/`fetchWithRetry`/`safeJsonParse`, тексты ошибок API,
  `get-popular-queries`.
- Остальные пакеты монорепо (`yandex-search-mcp`, `yandex-wordstat-mcp`,
  `yandex-metrika-mcp`, `yandex-direct-mcp`), `scripts/`, `.github/`.
- `package.json`, `bun.lock`, версии пакетов, `README.md`, `TASKS.md`, `server.json`.
- Существующие тесты.
- `.env`, токены, живые запросы к API Вебмастера — запрещены (тесты только на фикстурах).
- Любые файлы вне списка AC-008. Исключений нет: эта спека уже закоммичена.

## 6. Критерии приёмки

Все команды — из корня клона; тесты и линт — в Docker под `-u 1002:1002`.

- **AC-001.** Весь корпус тестов монорепо зелёный (единственный полный прогон; включает приёмочные тесты).
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node --test'`
- **AC-002.** Линт пакета Webmaster чистый.
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node_modules/.bin/biome check packages/yandex-webmaster-mcp'`
- **AC-003.** Все серверы стартуют, у Webmaster по-прежнему 33 тула.
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation && out=$(docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node scripts/smoke-tools.mjs) && printf "%s" "$out" | grep -q "yandex-webmaster-mcp: 33 tools"'`
- **AC-004.** Приёмочные тесты и фикстура не изменены.
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation/packages/yandex-webmaster-mcp/test && printf "%s\n" "03ad3fda564f0aa148d19a3483fc1f83470728953eb5872b55acf6e08331f1a8  diagnostics-format.test.mjs" "db5af7f6c4e48a865dbff2d6898ced53c3830ad314203cee8d8984b5857b3d5f  diagnostics-tool.test.mjs" "78adc37d28b74e1b7999cb909023be2052b612c7a58484956f8b21c498c64fda  fixtures/diagnostics-not-mobile-friendly.json" | sha256sum -c --quiet'`
- **AC-005.** Тул отдаёт текст через форматтер, сырого JSON с обрезкой больше нет.
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation/packages/yandex-webmaster-mcp && grep -q "text: formatDiagnostics(data)" src/index.mjs && ! grep -n "JSON.stringify(data.problems" src/index.mjs && grep -q "^export function formatDiagnostics(data)" src/format.mjs'`
- **AC-006.** В CHANGELOG есть верхний раздел про get-diagnostics.
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation && awk "/^## /{n++} n==1" CHANGELOG.md | grep -q "get-diagnostics"'`
- **AC-007.** Дерево чистое (кроме report.json).
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation && test -z "$(git status --porcelain -- . ":(exclude)report.json" ":(exclude)report-blocked.md")"'`
- **AC-008.** Тронуты только разрешённые файлы, обязательные — тронуты.
  Проверка: `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation && changed=$(git diff --name-only 0f6a954450d2fb4f4bb4913386d7d79307f01731..HEAD) && test -z "$(printf "%s\n" "$changed" | grep -vxE "CHANGELOG\.md|docs/specs/diag-truncation\.md|packages/yandex-webmaster-mcp/(SKILL\.md|src/format\.mjs|src/index\.mjs|test/diagnostics-format\.test\.mjs|test/diagnostics-tool\.test\.mjs|test/fixtures/diagnostics-not-mobile-friendly\.json)")" && for f in CHANGELOG.md packages/yandex-webmaster-mcp/src/format.mjs packages/yandex-webmaster-mcp/src/index.mjs; do printf "%s\n" "$changed" | grep -qxF "$f" || exit 1; done'`

## 7. Контракт отчёта

`report.json` в КОРНЕ клона, untracked. Записей в `criteria` ровно восемь:
AC-001…AC-008. `blocked` — штатный исход, когда среда не даёт выполнить критерий
(нет Docker и т. п.): `"rc": null` и дословная ошибка в `note`. Обходить
несовместимость запрещено.

```json
{
  "schema_version": 2,
  "policy_id": "cross-review-v1",
  "spec_sha256": "<sha256 файла docs/specs/diag-truncation.md>",
  "base_sha": "0f6a954450d2fb4f4bb4913386d7d79307f01731",
  "reviewed_sha": "<коммит, отданный на ревью>",
  "final_sha": "<HEAD после единственного захода фиксов>",
  "executor": {"backend": "grok", "model": "<точная модель>"},
  "review": {
    "initial_receipts": ["initial-codex-1.json", "initial-agy-1.json"],
    "verification_receipts": [],
    "resolutions": [
      {"finding_id": "initial-codex-1:F001", "decision": "fixed|disproved|needs_owner",
       "source_receipt": "initial-codex-1.json",
       "fix_commits": ["<коммит>"], "proof": "<команда-доказательство>"}
    ]
  },
  "handoff_status": "ready",
  "criteria": [
    {"id": "AC-001", "status": "pass|fail|blocked",
     "command": "<команда ИЗ ЭТОЙ СПЕКИ, посимвольно>", "rc": 0, "note": "…"}
  ]
}
```

После сборки отчёта прогнать
`python3 /home/deploy/.claude/skills/executor-milestone/scripts/accept_run.py /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation --spec /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation/docs/specs/diag-truncation.md --dry-run`
и добиться кода 2 (`validation_only`).

## 8. Контракт на невыполнимое

Остановись и доложи (`status: blocked`, `rc: null`, дословная ошибка в `note`), если:
нет Docker или образа `node:22-alpine`; не хватает зависимости; утверждение §3 не
подтверждается кодом базы; приёмочный тест противоречит §4 или другому приёмочному
тесту (не «чини» тест — это дефект спеки); для критерия нужен файл вне списка AC-008.
Запрещено: `|| true`, `|| :`, `; true`, `set +e`, `--no-verify`, `sudo`, новые
зависимости, правка приёмочных и существующих тестов, сетевые вызовы к API
Вебмастера, чтение `.env`/токенов, `git push`, tmux-команды на хосте.

## 9. Мутации

Мутационный прогон — отдельная работа противоположного исполнителя ПОСЛЕ приёмки.
Приёмочные тесты рассчитаны убивать: возврат `substring` по символам; печать
ABSENT-записей; потерю сортировки по степени или по коду; лимит 50 → 49/51 и
`>` → `>=`; снятую строку «... and N more»; дату целиком вместо первых 10 символов;
`null`-дату как пропуск записи; «no data» на пустом `problems`; `index.mjs`, не
вызывающий `formatDiagnostics`.

## 10. Авторевью `cross-review-v1`

1. Реализация → собственная проверка → коммит: это REVIEW_SHA.
2. Исполнитель Grok → пара ревьюеров `codex` + `agy`. Сам себя не ревьюит никто.
3. Оба ревью параллельно на `BASE_SHA..REVIEW_SHA`, отдельными вызовами, только чтение:
   `bash /home/deploy/.claude/skills/executor-milestone/scripts/review_run.sh initial <ревьюер> --clone /home/deploy/exec-clones/yandex-webmaster-mcp-diag-truncation --base 0f6a954450d2fb4f4bb4913386d7d79307f01731 --range 0f6a954450d2fb4f4bb4913386d7d79307f01731..<REVIEW_SHA> --context "yandex-webmaster-mcp: get-diagnostics перечисляет все PRESENT-проблемы без обрезки по символам; только чтение"`
   run_id = `yandex-webmaster-mcp-diag-truncation-0f6a954450d2`.
4. Нет маркера `ВЕРДИКТ:` / оборванный ответ → `incomplete`, не «находок нет».
5. По каждой находке: `fixed` / `disproved` / `needs_owner`.
6. Один заход исправлений → FINAL_SHA; те же ревьюеры один раз смотрят
   `REVIEW_SHA..FINAL_SHA` (фаза `verify`). Второго захода нет.
7. Квитанции пишет только `review_run.sh`; квота исчерпана → `blocked`.
8. Эксперименты с процессами и tmux — только в Docker с фейками; host tmux
   socket и чужие процессы не трогать.

## 11. Стыки

- Следующей вехи нет. Возможная отдельная задача (не здесь): у
  `yandex-wordstat-mcp` списки `slice(0, 20/24)` без пометки «показано N из M».
