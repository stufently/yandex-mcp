# yandex-webmaster-mcp: тесты get-diagnostics против выживших мутантов

- **Репозиторий:** `yandex-mcp` (монорепо), пакет `packages/yandex-webmaster-mcp`. Дата: 10.10.2026.
- **BASE_SHA:** `5ec43bdc9145c0aabfd2322e3d877e948ab73b74` — «List present diagnostics without truncation»
  (последний коммит ветки `grok/diag-truncation`). Следующий коммит после BASE — эта спека вместе с
  обвязкой мутаций `docs/specs/diag-mutant-tests.gate.py` (только эти два файла); клон снят с BASE.
- **Исполнитель:** Grok (`gk`) — код вехи `diag-truncation` писал Grok, исправления её тестов остаются
  ему. Мутационный прогон, по итогам которого написана веха, делал Codex независимо; приёмку, повторные
  мутации и ревью делает постановщик.

## Где работать

Только клон **`/home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests`**, текущая ветка
`grok/diag-mutant-tests` (новую ветку не заводить, не ребейзить, коммит постановщика не переписывать).
Живое дерево `/home/deploy/github/yandex-mcp` и прочие клоны в `/home/deploy/exec-clones/` не трогать.
**Push в origin запрещён** (push-URL `no-push`), работу заберёт постановщик через `git fetch` из клона.
Коммиты локальные, по именам файлов (`git add <путь>`, никогда `-A`). Git-хуки не включать.

Что положил постановщик до запуска:

| Путь | Как | Проверка |
|---|---|---|
| `node_modules/`, `packages/*/node_modules/` | `bun install --frozen-lockfile` в Docker `oven/bun:1` под `-u 1002:1002`, untracked, в `.gitignore` | `test -x node_modules/.bin/biome` |
| `docs/specs/diag-mutant-tests.md`, `docs/specs/diag-mutant-tests.gate.py` | закоммичены постановщиком | AC-008 |

Тесты и линт — только в Docker `node:22-alpine` под `-u 1002:1002`; node/biome на хосте не запускать.
Временные файлы — в `tmp/` клона (в `.gitignore`). Сети к API Вебмастера нет и не нужно: сквозные
тесты идут через `scripts/lib/call-tool.mjs` с подменённым `fetch`.

## Задача и почему

Веха `diag-truncation` добавила `formatDiagnostics` (`packages/yandex-webmaster-mcp/src/format.mjs`) и
перевела на него тул `get-diagnostics` (`src/index.mjs`). Независимый мутационный прогон Codex по её
тестам (`test/diagnostics-format.test.mjs`, `test/diagnostics-tool.test.mjs`) оставил четыре
НЕэквивалентных мутанта живыми: все 178 тестов монорепо зелёные при сломанном коде.

| Мутант | Правка | Почему выжил | Чем убить |
|---|---|---|---|
| M7 | в `format.mjs` сравнение кодов `<`/`>` заменено на `left.code.localeCompare(right.code)` | в тестах нет кодов, порядок которых различается по кодовым точкам и по локали | два PRESENT-кода одной степени `A_B` и `AA` → в тексте `AA` раньше `A_B` (`'A'` 0x41 < `'_'` 0x5F; ICU-сравнение ставит `A_B` первым) |
| M8 | в `format.mjs` `typeof value === 'string' && DIAGNOSTICS_DAY.test(value)` → `typeof value === 'string'` | все строковые даты в тестах начинаются с `YYYY-MM-DD` | дата-строка без такого префикса длиннее 10 символов печатается целиком |
| M9 | в `format.mjs` `const state = orNA(entry.state);` → `const state = String(entry.state);` | нет записи без `state` | запись без `state` → строка `Other states: N/A=1` |
| M10 | в `index.mjs` `structuredContent: data` → `structuredContent: { problems: data.problems }` | в фикстуре ответа нет полей кроме `problems` | ответ API с дополнительным полем → `structuredContent` равен ответу целиком |

Точный текст каждой мутации — в обвязке (словарь `MUTANTS`). Нужно дописать тесты так, чтобы каждый
мутант падал на ассерте СВОЕГО теста (имена ниже).

Боевой код не меняется. Исключение одно: если новый тест, написанный строго по поведению из этой спеки,
**падает на текущем немутированном коде** — это реальный дефект; тогда разрешена минимальная правка
`src/format.mjs` или `src/index.mjs`, и она обязана быть описана в `note` критерия AC-001 (что падало,
дословная строка ассерта, что изменено). Правка не должна трогать фрагменты, которые заменяет обвязка
(иначе обвязка вернёт `fragment count is 0`) — если без этого нельзя, см. «Контракт на невыполнимое».

## Что проверено вживую, а что предположение

Проверено постановщиком на BASE (Docker `node:22-alpine`, Node v22.23.2, `-u 1002:1002`):

1. `src/format.mjs`, `formatDiagnostics`: внутри одной степени PRESENT-записи сортируются
   `if (left.code < right.code) return -1; if (left.code > right.code) return 1; return 0;`;
   запись — строка `- <CODE> [<orNA(severity)>] since <дата>`; дата — `diagnosticDay(value)`:
   `value.slice(0, 10)`, если это строка и `DIAGNOSTICS_DAY = /^\d{4}-\d{2}-\d{2}/` совпал, иначе
   `orNA(value)`; не-PRESENT запись считается под ключом `orNA(entry.state)` (`entry` = `{}`, если
   значение не объект), строка `Other states: <STATE>=<n>, …` с сортировкой ключей по кодовым точкам.
   `orNA` → `'N/A'` для `undefined`/`null`/`''`, иначе `String(v)`.
2. `src/index.mjs`, тул `get-diagnostics`: `const data = await apiRequest(...)`, возврат
   `{ content: [{ type: 'text', text: formatDiagnostics(data) }], structuredContent: data }`.
3. В тестовых файлах уже есть хелперы `present(code, severity, date)`, `entryLines(text)`, `clone`,
   `FIXTURE` (format) и `PKG`, `HOST`, `USER`, `callTool`, `textOf` (tool) — пользоваться ими.
4. Обвязка `python3 docs/specs/diag-mutant-tests.gate.py <ID>` (из корня клона): для M7, M8, M9, M10
   каждый фрагмент встречается ровно один раз, чистая копия зелёная, на мутанте оба файла тестов
   зелёные, нужного теста нет → `<ID>: выжил: нет теста «…» (на мутанте all tests green)`, rc 1.
   То есть все четыре мутанта легли и сейчас выживают (AC-003…AC-006 на BASE красные).
5. Положительный контроль обвязки: K1 (дата печатается целиком, `return value.slice(0, 10);` →
   `return value;`) уже убит существующим тестом → `K1: убит: not ok - боевой ответ: … (ERR_ASSERTION)`,
   rc 0. Кроме того, черновики четырёх тестов из «Что сделать» (временно дописанные постановщиком и
   откаченные) дали `убит … (ERR_ASSERTION)`, rc 0, для M7, M8, M9 и M10, а на чистом коде были
   зелёными — тесты выполнимы, реального дефекта в боевом коде они не вскрыли.
6. Свидетели Codex на коде вехи: `formatDiagnostics({problems:{A_B:{state:'PRESENT',severity:'FATAL'},AA:{state:'PRESENT',severity:'FATAL'}}})`
   печатает `- AA …` раньше `- A_B …`, под M7 наоборот; дата `'not-a-date-with-extra-text'` печатается
   целиком, под M8 — `not-a-date`; запись `{severity:'FATAL'}` даёт `Other states: N/A=1`, под M9 —
   `undefined=1`; `callTool` с телом `{problems:{…}, server_time:'2026-10-10'}` возвращает
   `structuredContent` с `server_time`, под M10 — без него.
7. Полный корпус на BASE: `node --test` зелёный (178 тестов), `biome check packages/yandex-webmaster-mcp`
   чистый.
8. Как обвязка решает «убит»: TAP-вывод (`--test-reporter=tap`) обоих файлов тестов; убит, только если
   на мутанте тест с ДОСЛОВНЫМ именем из `MUTANTS` помечен `not ok` и в его блоке есть
   `code: 'ERR_ASSERTION'`, а на чистой копии тот же тест `ok`. Падение другого теста или ошибка без
   ассерта мутанта не убивают. Поэтому в имени теста нельзя менять ни символа; символы `#` и `\` в
   именах TAP экранирует — в именах ниже их нет.

Предположения: нет.

## Что сделать

Дописать в КОНЕЦ существующих файлов тесты (имена дословно; существующие строки файлов не менять и не
удалять). Каждый тест проверяет поведение `formatDiagnostics` / тула, а не текст исходника. В скобках —
какой мутант тест обязан убить; ориентир, не предмет теста.

### `packages/yandex-webmaster-mcp/test/diagnostics-format.test.mjs`

1. `коды внутри степени сравниваются по кодовым точкам: AA раньше A_B` (M7) — две PRESENT-записи одной
   степени с кодами `A_B` и `AA` (в объекте `problems` `A_B` идёт первым); строки-записи ровно
   `['- AA [<степень>] since …', '- A_B [<степень>] since …']` в этом порядке.
2. `строка даты без префикса YYYY-MM-DD печатается целиком` (M8) — PRESENT-запись с
   `last_state_update: 'not-a-date-with-extra-text'`; строка-запись заканчивается
   `since not-a-date-with-extra-text` (полностью, без обрезки).
3. `запись без state считается в Other states как N/A` (M9) — запись без поля `state` (например
   `{ severity: 'FATAL' }`); в тексте строка ровно `Other states: N/A=1`, строк-записей нет.

### `packages/yandex-webmaster-mcp/test/diagnostics-tool.test.mjs`

4. `get-diagnostics отдаёт в structuredContent весь ответ API, не только problems` (M10) — через
   `callTool` с ответом `/diagnostics`, в котором кроме `problems` есть ещё хотя бы одно поле верхнего
   уровня (например `server_time`); `assert.deepEqual(result.structuredContent, <ответ целиком>)`.

Тесты детерминированные, без сети, без таймеров; новых файлов и фикстур не заводить (данные — инлайн).
Код оформить так, чтобы `biome check packages/yandex-webmaster-mcp` был чистым (форматирование —
`biome check --write` в Docker только по этим двум файлам, если нужно; правки существующих строк от
форматтера недопустимы — AC-008 их ловит).

## Не трогать

Всё, кроме двух файлов тестов выше (и `src/format.mjs` / `src/index.mjs` только по исключению из
«Задача и почему»). В частности: эту спеку и `docs/specs/diag-mutant-tests.gate.py` (измерительный
инструмент приёмки — править его, чтобы мутант «умер», запрещено), фикстуру
`test/fixtures/diagnostics-not-mobile-friendly.json`, прочие тесты, `scripts/`, остальные пакеты
монорепо, `package.json`, `bun.lock`, `CHANGELOG.md`, `SKILL.md`, `README.md`, `.github/`, `.env`, токены.
Живые запросы к API Вебмастера запрещены.

## Критерии приёмки

Команды запускаются из любого каталога (каждая делает `cd` в клон). На BASE ожидается: AC-001, AC-002,
AC-007, AC-008 — зелёные; AC-003…AC-006, AC-009 — красные. Мутант-критерий занимает около 15 с.

- **AC-001. Весь корпус тестов монорепо зелёный (единственный полный прогон).**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node --test'`
- **AC-002. Линт пакета Webmaster чистый.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && docker run --rm -u 1002:1002 -v "$PWD":/app -w /app node:22-alpine node_modules/.bin/biome check packages/yandex-webmaster-mcp'`
- **AC-003. Мутант M7 (сравнение кодов через localeCompare) убит.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && python3 docs/specs/diag-mutant-tests.gate.py M7'`
- **AC-004. Мутант M8 (любая строка даты обрезается до 10 символов) убит.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && python3 docs/specs/diag-mutant-tests.gate.py M8'`
- **AC-005. Мутант M9 (String вместо orNA для состояния) убит.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && python3 docs/specs/diag-mutant-tests.gate.py M9'`
- **AC-006. Мутант M10 (structuredContent только с problems) убит.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && python3 docs/specs/diag-mutant-tests.gate.py M10'`
- **AC-007. Положительный контроль обвязки K1 убит.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && python3 docs/specs/diag-mutant-tests.gate.py K1'`
- **AC-008. Изменены только разрешённые файлы, существующие строки тестов целы, спека и обвязка не тронуты, дерево чистое.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests && s=$(git log --format=%H --diff-filter=A -1 -- docs/specs/diag-mutant-tests.md) && test -n "$s" && test "$(git rev-parse $s^)" = 5ec43bdc9145c0aabfd2322e3d877e948ab73b74 && for x in $(git diff --name-only $s HEAD); do case "$x" in packages/yandex-webmaster-mcp/test/diagnostics-format.test.mjs|packages/yandex-webmaster-mcp/test/diagnostics-tool.test.mjs|packages/yandex-webmaster-mcp/src/format.mjs|packages/yandex-webmaster-mcp/src/index.mjs) ;; *) echo "вне разрешённых: $x"; exit 1;; esac; done && test -z "$(git diff --numstat $s HEAD -- packages/yandex-webmaster-mcp/test | awk "\$2 != 0")" && git diff --quiet $s HEAD -- docs/specs/diag-mutant-tests.md docs/specs/diag-mutant-tests.gate.py && test -z "$(git status --porcelain -- . ":(exclude)report.json" ":(exclude)report-blocked.md")"'`
- **AC-009. Четыре новых теста названы дословно, без skip, todo и only.**
  `bash -c 'cd /home/deploy/exec-clones/yandex-webmaster-mcp-diag-mutant-tests/packages/yandex-webmaster-mcp/test && grep -qE "^test\(.коды внутри степени сравниваются по кодовым точкам: AA раньше A_B.," diagnostics-format.test.mjs && grep -qE "^test\(.строка даты без префикса YYYY-MM-DD печатается целиком.," diagnostics-format.test.mjs && grep -qE "^test\(.запись без state считается в Other states как N/A.," diagnostics-format.test.mjs && grep -qE "^test\(.get-diagnostics отдаёт в structuredContent весь ответ API, не только problems.," diagnostics-tool.test.mjs && ! grep -nE "\.(skip|todo|only)\(|\{ *(skip|todo|only) *:" diagnostics-format.test.mjs diagnostics-tool.test.mjs'`

## Контракт отчёта

`report.json` в корне клона, untracked, legacy-формат: ключи `criteria` и `final_sha`, без поля версии
схемы. Ровно 9 записей (AC-001…AC-009), команды дословно из спеки, `rc` фактический; у `blocked` —
`"rc": null` и дословная ошибка в `note`. Если правился боевой код — описание правки в `note` у AC-001
(иначе там же `боевой код не менялся`).

```json
{"criteria": [{"id": "AC-001", "status": "pass|fail|blocked", "command": "<команда спеки>", "rc": 0, "note": "…"}],
 "final_sha": "<HEAD клона>"}
```

Запрещено в `command`: `|| true`, `|| :`, `; true`, `set +e`, `--no-verify`, `sudo`, `git push`,
`docker system prune`.

## Авторевью

Исполнитель авторевью НЕ запускает: ревью и повторный мутационный прогон делает постановщик. Закоммить
работу, прогони все девять критериев, положи `report.json`. Мутант-критерии пишут только в
`tmp/mut/<ID>/` и живые файлы не меняют; запускай их последовательно и не параллельно с AC-001 (копии
дерева в `tmp/mut/` живут только во время прогона обвязки).

## Контракт на невыполнимое

Остановись, сохрани частичную работу локальным коммитом и положи `report-blocked.md` с точной уликой
(команда, cwd, rc, дословный вывод), если: родитель коммита спеки не равен BASE_SHA или `HEAD` клона до
твоих коммитов не равен коммиту спеки; нет Docker или образа `node:22-alpine`; нет `node_modules`;
AC-001 или AC-007 красный ДО твоих правок; обвязка отвечает `setup:` (rc 2) на немутированном коде без
твоей правки боевого кода; мутанта нельзя убить без правки вне разрешённых путей, без правки обвязки или
без ослабления мутации; мутант эквивалентный (объясни, почему наблюдаемое поведение не меняется);
правка боевого кода по исключению задевает заменяемый обвязкой фрагмент; критерий противоречит спеке.
Обходить несовместимость ЗАПРЕЩЕНО. Вопросов владельцу не задавать.

## Стыки с соседними вехами

Веха закрывает пробелы тестов вехи `diag-truncation` (ветка `grok/diag-truncation`). Запись в CHANGELOG,
слияние и релиз — у постановщика после приёмки.
