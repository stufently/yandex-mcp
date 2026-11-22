# Веха: MCP Registry ждёт версию на npm — yandex-mcp

- Репозиторий `yandex-mcp` (`~/github/yandex-mcp`, GitHub `stufently/yandex-mcp`), дата 22.11.2026.
- BASE_SHA: `33341f3b79a87006d663e81968221e72e7c9640f` («Bump docker/login-action from 4.7.0 to 4.8.0 (#17)») —
  `origin/main` после `git fetch`, коммит, с которого снят клон. Поверх него в клоне ОДИН коммит
  постановщика: эта спека и пробник. Левая граница диффа ревью и `base_sha` отчёта — именно BASE_SHA.
- Исполнитель: `cx` (Codex) — решение координатора: владелец отдал бэклог Codex после сброса недельного
  лимита. Мутации по пробнику и скрипту гоняет ПРОТИВОПОЛОЖНЫЙ исполнитель (Qwen) отдельным прогоном.
- Критериев: 5. Контекст: `~/gitlab/9qw/tg-claude-userbot/TASKS.md`, пункт
  «yandex-mcp: publish.yml — гонка registry с npm (заведено 10.11.2026)».

## Где работать

Одноразовый клон `/home/deploy/exec-clones/npm-wait-ymcp-20261122`, ветка `npm-wait-registry` (уже
создана и выбрана, на ней коммит постановщика со спекой и пробником). Живое дерево
`~/github/yandex-mcp` и соседние клоны не трогать.

git pull в клоне не делать; push в origin запрещён, работу заберёт постановщик через `git fetch` из клона.
`git push` запрещён в любой remote. Теги, релизы, `gh release …`, `gh workflow run`, `npm publish`,
`mcp-publisher` — запрещены: веха меняет только файлы. Коммиты локальные, `git add` по именам файлов,
никогда `-A`. Артефакты ревью — в `review/` в корне клона (untracked, не коммитить).

Что лежит в клоне от постановщика (закоммичено, менять запрещено):

| Файл | sha256 |
|---|---|
| `docs/specs/npm-wait-registry.md` | эта спека |
| `docs/specs/npm-wait-probe.sh` | `a3bad36d6f9524b8d5c053a73d2135706eb14b01eb40a721b3cba0465f042310` |
| `docs/specs/mcpb-checksums-wiring.py` | `3fe4e1bfc7fea575553eb24865031501a4e351f51f3e7f3d8d3eb700597d146b` (уже был в репо, прежняя веха) |

Зависимости ставить не нужно: критериям нужны `bash`, `sha256sum`, `python3` (stdlib) на хосте и образ
`rhysd/actionlint:1.7.12` (уже есть локально, внутри — `shellcheck`). Docker — только с `-u 1002:1002`.

## Задача и почему

Релиз по тегу `v*.*.*`: `publish.yml` публикует пять пакетов на npm (job `publish`), затем вызывает
`registry.yml` (job `registry`, `needs: publish`, `workflow_call`). Шаг `Publish` в `registry.yml` для
каждого пакета делает `npm view "$pkg@$version" mcpName`. Сразу после `npm publish` реестр npm ещё
несколько секунд отвечает на новую версию 404 — job падает, и registry приходится перезапускать руками.
Будет падать на каждом релизе.

Что сделать по сути: перед `npm view … mcpName` дождаться, пока npm начнёт отдавать ровно эту версию
(повторы с паузой), отдельным скриптом, который проверяется пробником без сети.

**Что может сломаться и обязано остаться целым:** остальная логика шага `Publish` (проверка версий
`server.json`, пропуск уже опубликованного в registry, сверка `mcpName`, `./mcp-publisher publish`),
шаги установки и логина `mcp-publisher`, ручной запуск `workflow_dispatch` с `inputs.packages`.

## Что проверено вживую, а что предположение

Проверено 22.11.2026 постановщиком (`git fetch`, `gh run list`, `gh run view --log-failed`, чтение файлов).

- Сбой воспроизводится по логу: run `42746852973` (тег v2.3.0, 10.11.2026), попытка 1, job
  «MCP Registry / Publish server.json files», шаг `Publish`:
  `npm error 404 No match found for version 2.3.0` …
  `'@stufently/yandex-search-mcp@2.3.0' could not be found`, `Process completed with exit code 1`.
  Перезапуск job прошёл (итог run — success).
- `.github/workflows/registry.yml` на BASE_SHA: `on: workflow_call` и `workflow_dispatch` (input
  `packages`); job `registry` из шагов `Checkout`, `Install mcp-publisher`, `Log in with GitHub OIDC`,
  `Publish`. В `Publish`: `set -euo pipefail`; цикл `for short in $PACKAGES`; переменные `file`, `name`,
  `version`, `pkg=$(jq -r '.packages[0].identifier' "$file")`; сверка версий; `curl` к registry с
  `continue` при 200; затем `npm view "$pkg@$version" mcpName > npm-mcpname.txt`, сверка с `$name`,
  `./mcp-publisher publish "$file"`. Шага `actions/setup-node` в этом job нет — используется `npm`
  раннера `ubuntu-latest` (он там есть: строка `npm view` и упала именно с `npm error`, а не
  «command not found»).
- `.github/workflows/publish.yml`: job `registry` с `needs: publish` и `uses: ./.github/workflows/registry.yml`.
  Его менять не нужно: ожидание целиком в `registry.yml`, тогда оно работает и при ручном запуске.
- `docs/specs/mcpb-checksums-wiring.py` (в репо с прошлой вехи, sha256 выше): отбрасывает строки-
  комментарии YAML и проверяет, что подстроки идут в заданном порядке; rc=0 — порядок соблюдён.
- `actionlint` 1.7.12 — последний релиз rhysd/actionlint на 22.11.2026 (`gh api …/releases/latest`).
- Пробник `npm-wait-probe.sh` прогнан постановщиком: на эталонной реализации `PROBE PASSED`, rc=0; на
  уклончивых реализациях (без паузы; пауза и после последней попытки; успех на любом непустом ответе;
  успех по подстроке; 10 попыток по умолчанию вместо 30; rc=0 по таймауту; без обрезки хвостовых
  пробелов; `npm view "$pkg"` без версии) — rc=1 каждая. На чистом клоне — rc=1,
  `FAIL: no scripts/wait-npm-version.sh`.
- **Предположение:** после того как `npm view "$pkg@$version" version` начал отдавать версию, registry
  (`mcp-publisher publish`, который сам ходит в npm) тоже её видит. Живым тегом не проверяется — проверит
  первый настоящий релиз после мержа (за координатором). Повторов вокруг `mcp-publisher` в этой вехе нет.

## Что сделать

### 1. `scripts/wait-npm-version.sh` (новый файл)

Интерфейс ровно такой (его проверяет пробник AC-001):

```
bash scripts/wait-npm-version.sh PKG VERSION [ATTEMPTS] [DELAY]
```

- `PKG` — имя пакета npm (например `@stufently/yandex-search-mcp`), `VERSION` — точная версия.
  Пустой или отсутствующий `PKG`/`VERSION` → сообщение в stderr, rc ≠ 0, `npm` не вызывается.
- `ATTEMPTS` — число попыток, целое ≥ 1, по умолчанию `30`; `DELAY` — пауза в секундах между
  попытками, целое ≥ 0, по умолчанию `10`. Не целое / отрицательное / `ATTEMPTS` = 0 → stderr,
  rc ≠ 0, `npm` не вызывается.
- Одна попытка = ровно `npm view "$PKG@$VERSION" version` (`npm` и `sleep` вызываются ПО ИМЕНИ через
  `PATH`, без абсолютных путей: пробник подкладывает фейки). Успех попытки — когда rc команды 0 и её
  stdout после обрезки хвостовых пробельных символов (пробелы, `\n`) РАВЕН `VERSION` целиком. Ответ
  с другой версией, пустой ответ или ненулевой rc — неуспех попытки (не ошибка скрипта).
- Успех → сообщение в stdout, rc 0, сразу (без паузы после успешной попытки).
- Между неуспешными попытками — `sleep "$DELAY"`; после ПОСЛЕДНЕЙ неуспешной попытки паузы нет.
  Итого при провале: ровно `ATTEMPTS` вызовов `npm` и `ATTEMPTS-1` вызовов `sleep`.
- Все попытки неуспешны → строка с аннотацией `::error::` и с `PKG@VERSION` (в stderr), rc ≠ 0.
- `set -euo pipefail`; stdin не читать; чисто под `shellcheck`.

### 2. `.github/workflows/registry.yml`

В шаге `Publish`, внутри цикла, ПОСЛЕ присваивания `pkg=$(jq …)` и ДО строки
`npm view "$pkg@$version" mcpName > npm-mcpname.txt` добавить вызов ровно в таком виде (его ищет AC-002):

```bash
            bash scripts/wait-npm-version.sh "$pkg" "$version"
```

Короткий комментарий над вызовом (почему: npm несколько секунд отдаёт 404 на только что
опубликованную версию) — по желанию. Больше в workflow ничего не менять: ни триггеры, ни
`permissions`, ни `env`, ни пины, ни прочие шаги и строки шага `Publish`. Вызов стоит и ПОСЛЕ проверки
«уже в registry → continue» или до неё — без разницы для критериев; предпочтительно после неё
(не ждать npm для того, что пропускается).

### 3. CHANGELOG.md

Новая верхняя секция в принятом в файле формате `## 2026-11-22 — <заголовок>` (по-русски, как весь
CHANGELOG), подсекция `### Fixed`: job MCP Registry ждёт, пока npm начнёт отдавать опубликованную версию
(до 30 попыток с паузой 10 с), вместо падения на 404 сразу после `npm publish`.

## Не трогать

- `.github/workflows/publish.yml` и все остальные workflow, кроме `.github/workflows/registry.yml`.
- Исходный код пакетов, `packages/**`, `server.json`, тесты, `scripts/` (кроме нового файла),
  `README.md`, `Dockerfile*`, `package.json`, `bun.lock`, `biome.json`.
- Файлы постановщика в `docs/specs/` (спека, пробник, `mcpb-checksums-wiring.py`) — их sha256 вшиты в
  критерии. Спека и пробник уже закоммичены постановщиком: отдельно коммитить их не нужно.
- Полный список разрешённых к изменению файлов — в AC-004; всё прочее — нарушение вехи.

## Критерии приёмки

Команды запускаются из корня клона.

- **AC-001.** Скрипт ожидания на фейковых npm и sleep: повторы, паузы, точное совпадение версии,
  умолчания 30 и 10, отказ на плохих аргументах. Пробник постановщика, его sha256 вшит:
  `bash -c 'echo "a3bad36d6f9524b8d5c053a73d2135706eb14b01eb40a721b3cba0465f042310  docs/specs/npm-wait-probe.sh" | sha256sum -c - && bash docs/specs/npm-wait-probe.sh scripts/wait-npm-version.sh'`
- **AC-002.** Шаг Publish зовёт ожидание внутри цикла после вычисления pkg и до npm view mcpName
  (порядок проверяется, строки-комментарии не считаются):
  `bash -c 'echo "3fe4e1bfc7fea575553eb24865031501a4e351f51f3e7f3d8d3eb700597d146b  docs/specs/mcpb-checksums-wiring.py" | sha256sum -c - && python3 docs/specs/mcpb-checksums-wiring.py .github/workflows/registry.yml "name: Publish" "for short in" "pkg=\$(jq -r" "bash scripts/wait-npm-version.sh \"\$pkg\" \"\$version\"" "npm view \"\$pkg@\$version\" mcpName" "./mcp-publisher publish"'`
- **AC-003.** `actionlint` 1.7.12 в Docker зелёный по всем workflow, `shellcheck` зелёный по новому скрипту:
  `bash -c 'docker run --rm -u 1002:1002 -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.12 && docker run --rm -u 1002:1002 -v "$PWD":/repo -w /repo --entrypoint shellcheck rhysd/actionlint:1.7.12 scripts/wait-npm-version.sh'`
- **AC-004.** Других изменений нет: от BASE_SHA изменены только разрешённые файлы, и обязательные
  среди них есть:
  `bash -c 'c="$(git diff --name-only 33341f3b79a87006d663e81968221e72e7c9640f..HEAD)" && test -z "$(printf "%s\n" "$c" | grep -vxF -e .github/workflows/registry.yml -e CHANGELOG.md -e scripts/wait-npm-version.sh -e docs/specs/npm-wait-registry.md -e docs/specs/npm-wait-probe.sh)" && printf "%s\n" "$c" | grep -qxF .github/workflows/registry.yml && printf "%s\n" "$c" | grep -qxF CHANGELOG.md && printf "%s\n" "$c" | grep -qxF scripts/wait-npm-version.sh'`
- **AC-005.** Дерево чистое, работа закоммичена:
  `bash -c 'test -z "$(git status --porcelain -- . ":(exclude)report.json" ":(exclude)report-blocked.md" ":(exclude)review/")"'`

Ожидание на клоне до работы (проверено постановщиком): AC-001, AC-002, AC-004 — красные (нет скрипта /
нет вызова / нет изменений), AC-003 — красный только на `shellcheck` (файла нет), AC-005 — зелёный.

## Контракт отчёта

`report.json` в КОРНЕ клона, untracked, схема v2 (её проверяет `accept_run.py` до запуска критериев):

```json
{"schema_version": 2,
 "policy_id": "cross-review-v1",
 "handoff_status": "ready",
 "executor": {"backend": "codex", "model": "<точная модель>"},
 "spec_sha256": "<sha256 файла docs/specs/npm-wait-registry.md>",
 "base_sha": "33341f3b79a87006d663e81968221e72e7c9640f",
 "reviewed_sha": "<коммит, отданный на ревью>",
 "final_sha": "<HEAD клона после единственного захода фиксов>",
 "review": {"initial_receipts": [], "verification_receipts": [], "resolutions": []},
 "criteria": [{"id": "AC-001", "status": "pass|fail|blocked",
               "command": "<команда ИЗ ЭТОЙ СПЕКИ, посимвольно>", "rc": 0, "note": "…"}]}
```

Записей в `criteria` ровно 5, AC-001…AC-005. Поле — `reviewed_sha`, не `review_sha`; три sha — 40
строчных hex; `final_sha` = HEAD клона; `base_sha → reviewed_sha → final_sha` — предки друг друга.
`command` совпадает с командой критерия ДОСЛОВНО. Квитанции ревью перечисляются в
`review.initial_receipts` / `review.verification_receipts`. Перед сдачей:
`python3 /home/deploy/.claude/skills/executor-milestone/scripts/accept_run.py /home/deploy/exec-clones/npm-wait-ymcp-20261122 --spec /home/deploy/exec-clones/npm-wait-ymcp-20261122/docs/specs/npm-wait-registry.md --dry-run`
обязан дать код 2 (`validation_only`).

`blocked` — штатный исход, когда среда не даёт выполнить критерий: `"rc": null`, в `command`
команда-улика, в `note` дословная ошибка. Обходить несовместимость (`--no-deps`, `|| true`,
`set +e` в команде критерия, `sudo`, `git push`) ЗАПРЕЩЕНО.

## Контракт на невыполнимое

Противоречие в спеке, невыполнимый критерий, факт, опровергающий раздел «Что проверено» (в том числе:
`registry.yml` устроен не так, как описано; `actionlint` красный на нетронутом дереве; пробник требует
поведения, противоречащего интерфейсу из раздела 1) — **остановись и доложи**: `report-blocked.md` в
корне клона с дословной командой, выводом и опровергнутым утверждением. Править пробник, спеку и
`mcpb-checksums-wiring.py`, ослаблять критерии — запрещено.

## Автономное перекрёстное ревью

Действует `cross-review-v1` целиком: `/home/deploy/.claude/skills/executor-milestone/docs/cross-review-v1.md`.
Пара ревьюеров по backend исполнителя: Codex или Spark → `agy` + `qwen`; Qwen → `codex` + `agy`.
Сам себя не ревьюит никто.

1. Реализация → своя проверка всех AC → коммит: это REVIEW_SHA.
2. Оба ревью параллельно на `BASE_SHA..REVIEW_SHA`, каждое только читает:
   `bash /home/deploy/.claude/skills/executor-milestone/scripts/review_run.sh initial <ревьюер> --clone /home/deploy/exec-clones/npm-wait-ymcp-20261122 --base 33341f3b79a87006d663e81968221e72e7c9640f --range 33341f3b79a87006d663e81968221e72e7c9640f..<REVIEW_SHA> --context "yandex-mcp: registry job waits for npm version, read-only"`
   run_id = `npm-wait-ymcp-20261122-33341f3b79a8`; квитанции пишет только `review_run.sh`.
3. Дождаться ОБОИХ, свести находки, по каждой `fixed` / `disproved` / `needs_owner`. Один заход
   исправлений → FINAL_SHA. Затем те же два ревьюера ОДИН раз на `REVIEW_SHA..FINAL_SHA` (фаза
   `verification`, тот же `--base 33341f3b79a87006d663e81968221e72e7c9640f`); если код после ревью не
   менялся и споров нет — завершающая проверка пропускается. Второй заход исправлений запрещён.
4. Обрезанный вход, оборванный ответ или нет маркера `ВЕРДИКТ:` — `incomplete`, а не «находок нет».
   Один технический повтор незавершённого вызова допустим; исчерпанная квота — `blocked`, без цикла
   повторов. Эксперименты с процессами, сигналами и tmux — только в Docker с фейками.

## Стыки с соседними вехами

Релизов и тегов веха не делает. Первый настоящий релиз после мержа проверит предположение про
`mcp-publisher` (за координатором). Повторы вокруг самого `mcp-publisher publish`, если понадобятся, —
отдельная веха.
