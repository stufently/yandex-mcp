# Changelog

## 2026-08-21 (3)

### Added
- **Метрика: `delete-counter` требует явного `confirm: true`.** Сегодняшняя правка скоупа
  (`metrika:read metrika:write` по умолчанию) чинила настоящую проблему — 403 в момент
  использования, много позже того, как пользователь считал настройку законченной. Но вместе
  с 403 исчезла единственная ФАКТИЧЕСКАЯ защита от случайного удаления: в самом туле её не
  было, только слово «Irreversible» в описании, то есть надежда, что модель прочитает
  внимательно. Теперь без `confirm: true` тул возвращает объясняющий отказ (что необратимо,
  какой счётчик, что именно передать) и **не делает сетевого вызова** — проверка стоит до
  сборки запроса. Подтверждением считается только литеральный `true`: `"true"`, `1`, `"yes"` —
  это угадывание протокола, а не решение удалить. Скоуп остаётся пишущим по умолчанию:
  установка должна работать с первого раза (`src/confirm.mjs`).
- **Метрика: MCP-аннотации у `delete-counter`** (`destructiveHint: true`, `readOnlyHint: false`,
  `idempotentHint: false`) — SDK 1.27.1 их поддерживает, поэтому клиент видит риск тула до
  вызова, а не только из текста описания. Тул переведён на `registerTool` (у `server.tool(...)`
  подходящая перегрузка помечена `@deprecated`).
- **Тесты (9 новых):** отказ без подтверждения и что сеть при этом не дёргалась (DELETE
  инжектится и падает, если его позвали), `confirm: false` и строка `"true"` как отказ, успех
  с `confirm: true`, слова в тексте отказа; плюс проверка ЧЕРЕЗ реальный `tools/list`, что
  защита подключена к серверу и что `delete-counter` — единственный тул пакета с
  `destructiveHint`.

### Notes
- Остальные 11 тулов пакета разрушительных операций не выполняют: 10 читающих и `create-counter`,
  который добавляет счётчик и обратим удалением. Подтверждение больше нигде не потребовалось.

## 2026-08-21 (2)

Починка четырёх дефектов, найденных при разборе кода. Все четыре — тихие: API отвечает 200,
никто не падает, а данные при этом неверные или прав не хватает.

### Fixed
- **Метрика: токен не мог сделать то, что обещали тулы.** Хелпер `auth` просил ТОЛЬКО
  `metrika:read`, при этом сервер выставляет `create-counter` и `delete-counter`. Пользователь
  получал 403 в момент создания счётчика — то есть после того, как считал настройку законченной.
  Теперь по умолчанию запрашивается `metrika:read metrika:write`; сузить обратно можно
  осознанно через `YANDEX_METRIKA_SCOPE="metrika:read"`. Оба пишущих тула сообщают требование
  прямо в своём описании, а 403 от Management API дополняется подсказкой, какого скоупа не
  хватает (`src/scopes.mjs`).
- **Директ: ветка ретрая была мертва.** В `apiRequest` список `['52','1000','1001','1002']`
  проверялся, после чего ОБЕ ветки — «ретраебельная» и обычная — бросали побайтово одинаковую
  ошибку. Ретрая не было вообще, но код выглядел так, будто временные сбои обрабатываются.
  Причина, по которой обмануться было легко: Директ отдаёт такие сбои как HTTP **200** с телом
  `error`, поэтому `fetchWithRetry`, работающий по статусу, их не видит в принципе. Теперь
  `apiRequest` сам ретраит эти коды с экспоненциальной задержкой (до 3 повторов) и в финальном
  сообщении честно пишет `after N retries` (`src/errors.mjs`).
  ⚠️ **Повторяются ТОЛЬКО читающие методы** (`isRetrySafeMethod`: имя метода `get`/`getXxx`).
  Транзиентная ошибка говорит «не получилось», но НЕ говорит «не применилось»: у Директа нет
  ключа идемпотентности, поэтому повтор отвалившегося `campaigns.add` мог бы создать вторую
  кампанию в боевом аккаунте. Упавшая запись возвращается вызывающему как ошибка — это
  поправимо, молча задвоенная — нет. Исключение: HTTP **429** повторяется всегда, включая
  записи, — отказ по лимиту означает, что запрос не выполнялся вовсе.
  ⚠️ **`apiRequest` больше НЕ ходит через `fetchWithRetry`.** Вложенность двух циклов множила
  бюджеты: до 16 физических запросов на один вызов, и — что хуже — записи всё равно
  переотправлялись на HTTP-уровне (network/429/5xx), хотя на уровне JSON повтор уже был
  запрещён. Теперь `apiRequest` владеет всей политикой целиком, а `maxAttempts` (деф. 4) —
  это полное число запросов, которые вообще уйдут наружу.
- **Директ: фильтр строки «Итого» резал живые данные и зависел от языка.** Условие
  `line.startsWith('Total') || line.startsWith('Итого')` ошибалось в обе стороны: молча удаляло
  РЕАЛЬНЫЕ строки отчёта, если кампания называется «Total Sales Q1» или «Итоговая распродажа»,
  и не ловило сводку ни в одной другой локали, на которой Директ умеет отвечать (`Toplam`,
  `Разом`). Текстовое сопоставление убрано полностью. Сводку глушим у источника — заголовком
  `skipReportSummary: true`, который и так уже отправлялся, — а язык ответа фиксируем
  `Accept-Language: en`. Парсер теперь НЕ выбрасывает ни одной строки вообще: короткая строка
  добивается пустыми ячейками — ровно как старый код поступал с недостающими хвостовыми
  колонками (`src/report.mjs`). Промежуточный вариант со «структурным гвардом» (выбрасывать
  строки с меньшим числом колонок) отвергнут по ревью: он заменил бы один канал тихой потери
  данных другим. Заодно перестал прилипать `\r` к последней колонке при CRLF.
- **Вебмастер: `date_to` съедал последний день диапазона.** Дата конца отображалась в
  `T00:00:00Z` — то есть в момент, когда последние сутки только НАЧИНАЮТСЯ, поэтому весь
  последний день выпадал из выборки: запрос `2026-08-01 → 2026-08-21` возвращал данные по
  20 августа включительно. Дефект невидим снаружи — API отвечает 200, просто ряд короче.
  Теперь `date_to` мапится на конец суток (`T23:59:59.999Z`), а перевёрнутый диапазон
  отбивается до сети понятной ошибкой (`src/dates.mjs`).

### Changed
- **Версии всех пяти пакетов выровнены на `2.2.0`.** `publish.yml` публикует все пять по
  ОДНОМУ тегу `v*.*.*`, а версии разъехались (2.0.0 / 2.1.0 / 1.1.0 / 1.0.0 / 1.0.0), из-за
  чего первый же релиз опубликовал бы неверные номера. `2.2.0` выбрана как минимальная выше
  максимальной существующей (2.1.0) — так ни один пакет не едет назад, что npm запретил бы.
  Тег НЕ ставился.
- Чистые хелперы вынесены в отдельные модули по конвенции репо и покрыты тестами:
  `direct/src/{errors,report}.mjs`, `webmaster/src/dates.mjs`, `metrika/src/scopes.mjs`.
  Тестов стало 59 (было 32); smoke по-прежнему зелёный на 91 инструменте.
- Версия в MCP-хендшейке (`new McpServer({version})`) у всех пяти серверов тоже поднята до
  `2.2.0` — раньше она жила отдельно от `package.json` и осталась бы на старых числах.
  Синхронизированы и версии воркспейсов в `bun.lock` (проверено: `bun install
  --frozen-lockfile` проходит и до, и после правки, то есть CI не ломался ни в одном из
  состояний).

### Fixed (по итогам ревью)
- **Хелпер `auth` не показывал полученный токен — ни в Метрике, ни в Вебмастере.** Печатались
  первые 8 символов, после чего следовала инструкция «set this as `YANDEX_*_TOKEN`» —
  выполнить её было невозможно, то есть весь встроенный OAuth-флоу (и только что описанный
  в README сценарий) не работал. Теперь токен печатается целиком в stderr с пометкой, что
  повторно он показан не будет.
- **Метрика: проверяем ВЫДАННЫЙ скоуп, а не только запрошенный.** Если OAuth-приложение не
  зарегистрировано с правом на запись, Яндекс молча вернёт read-only токен, и `create-counter`
  упал бы позже и далеко от причины. `auth` сверяет `data.scope` и предупреждает сразу.
- **Вебмастер: даты валидируются ДО сетевого вызова.** В семи тулах `dateParams` вычислялся
  вторым аргументом, после `await hostUrl(...)`, который на холодном кеше ходит в `/user` —
  то есть заведомо неверный диапазон сначала стоил запроса. Вычисление поднято выше вызова.

## 2026-08-21

Снятие блокеров продвижения: репо был готовым продуктом, о котором нельзя было узнать.
Логика серверов не тронута — только упаковка и документация.

### Added
- **`.claude-plugin/marketplace.json` — репо не подключался как marketplace ВООБЩЕ.**
  `.claude-plugin/plugin.json` лежал с самого начала, но без каталога marketplace команда
  `/plugin marketplace add stufently/yandex-mcp` не работает: плагин был оформлен и при этом
  недостижим. Теперь `/plugin install yandex-mcp@stufently` ставит все 5 серверов и обе
  скилы разом.
- **README: раздел «Install» с плагином Claude Code первым вариантом.** Плагин не был упомянут
  в README ни разу — самый дешёвый канал распространения существовал и молчал. Добавлена
  таблица «что даёт плагин против ручного MCP-конфига» и явная оговорка, что Claude Code
  подставляет только `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`/`${CLAUDE_PROJECT_DIR}`,
  а токены Яндекса пользователь задаёт сам (шелл или `~/.claude/settings.json`).
- **README: готовые copy-paste конфиги** для Claude Code (`claude mcp add` + `.mcp.json`),
  Claude Desktop (с путями конфига под macOS/Windows/Linux) и Cursor, все пять серверов с env.
- **README: раздел «Common Prompts»** — 4–6 примеров запросов на каждый сервер, сверенных с
  реальными тулами, плюс предупреждение, что write-тулы Директа бьют в прод без dry-run и
  ставки идут в микрах.
- **`keywords`, `homepage`, `bugs`, `author` во всех пяти `package.json`.** `keywords` не было
  ни в одном пакете — в npm это прямая потеря поиска по реестру.

### Fixed
- **`plugin.json` указывал на файлы ЗА пределами репо — плагин не собрался бы даже после
  добавления marketplace.** Пути компонентов резолвятся от КОРНЯ ПЛАГИНА (каталог, содержащий
  `.claude-plugin/`), а не от самого `.claude-plugin/`, поэтому `"../plugin.mcp.json"` и
  `"../.claude/skills/"` уезжали на уровень выше корня: MCP-серверы не зарегистрировались бы,
  скилы не подхватились бы. Исправлено на `"./plugin.mcp.json"` и `"./.claude/skills/"`.
  Баг лежал с момента появления манифеста и был незаметен ровно потому, что плагин никто не
  мог установить (см. marketplace.json выше) — два блокера маскировали друг друга.
  Подтверждено инструментом: `claude plugin validate . --strict` давал три ошибки по
  `mcpServers`/`skills`, теперь проходит чисто (добавлен ещё и `author`, которого требовал
  `--strict`).
- **Версия плагина дублировалась** в `plugin.json` и в записи каталога `marketplace.json` —
  при расхождении обновление у пользователей встало бы молча. В каталоге версия убрана,
  единственный источник правды — `plugin.json`.
- **README обещал неверную команду обновления**: `/plugin marketplace update` обновляет
  КАТАЛОГ, а не установленный плагин. Верное — `/plugin update yandex-mcp@stufently`.
- **Промпт про регионы Wordstat обещал недоступную сортировку.** Тул `regions` сортирует по
  `count` и только потом режет по `limit` (`src/index.mjs:423-425`), поэтому «отсортируй по
  affinity, а не по объёму» недостижимо: регионы, выпавшие по лимиту, модель уже не вернёт.
  Формулировка примера исправлена.
- **GitHub topics отсутствовали полностью** (`repositoryTopics: null`) — репо не находился ни
  по `mcp`, ни по `mcp-server`, ни по `claude-code`. Проставлено 15 тем; `description`
  дополнен Директом (упоминались только 4 сервера из 5).
- **`plugin.json` не знал про Директ**: описание перечисляло search/wordstat/webmaster/metrika,
  хотя `plugin.mcp.json` уже регистрировал `yandex-direct`. Добавлены также `homepage` и
  `repository`.

### Notes
- **Bun обязателен, а не опционален**: корневой `bun.lock` заставляет Claude Code ставить
  зависимости плагина через Bun, фолбэка на npm нет. В README перед «Install» добавлено
  требование Node ≥22 + Bun на `PATH` — иначе установка на чистой машине молча не соберётся.
- Публикация в npm НЕ выполнена и тегов не ставилось — нужен `NPM_TOKEN` владельца
  (см. `TASKS.md`; там же уточнено, что токен нужен granular с «Bypass 2FA», и что версии
  пакетов разъехались, а `publish.yml` публикует все пять по одному тегу). Готовность проверена `npm pack --dry-run` по всем пяти пакетам: имена в
  скоупе, `publishConfig.access: public`, `repository.directory`, шебанги в `bin` — на месте.

## 2026-07-30

Доработка по ревью Codex переезда на скоуп (все три находки проверены по коду, не по докам).

### Security
- **Два рантайм-сообщения об ошибке продолжали посылать пользователя в ЧУЖОЙ пакет.**
  `yandex-metrika-mcp` и `yandex-webmaster-mcp` при отсутствии токена печатали
  «Run `npx yandex-{metrika,webmaster}-mcp auth`» — то есть предлагали выполнить код издателя
  `altrr2` в момент, когда в окружении лежат `YANDEX_CLIENT_ID`/`YANDEX_CLIENT_SECRET`.
  Вчерашняя правка закрыла README и конфиги, но не исходники. Теперь сообщение указывает на
  собственный entrypoint (`process.argv[1]`), рядом — комментарий, почему `npx` тут нельзя.
- **`prompt.md` восстановил бы старую небезопасную конфигурацию при повторном использовании.**
  Он объявлял unscoped npm-имена как имена пакетов, а секция Wordstat описывала мёртвый
  `YANDEX_WORDSTAT_TOKEN` + закрытый `api.wordstat.yandex.net` + OAuth-флоу, удалённый в v2.0.
  Добавлен баннер «это историческое задание», имена переведены в скоуп, актуальные креды и
  эндпоинты Wordstat описаны рядом с помеченным legacy-блоком, шаблон `package.json` приведён
  к скоупу с `repository` и `publishConfig`. Вторым проходом ревью нашлись последние следы:
  корневой `.env.example` вёл Wordstat на `oauth.yandex.com`, а дерево файлов в `prompt.md`
  всё ещё показывало удалённый `src/auth.mjs` — при фрагментарном чтении агент восстановил бы
  и то, и другое.

### Fixed
- **Публикация с `--provenance` упала бы на всех пяти пакетах.** npm требует поле `repository`,
  совпадающее с GitHub-репозиторием; его не было ни в одном `package.json`. Добавлено с
  `directory` на пакет.

## 2026-07-29

Все находки ниже проверены на боевых API (Вебмастер, Wordstat v2) — не по докам.

### Fixed
- **yandex-webmaster-mcp: 4 тула не работали вовсе — неверные пути.** `get-insearch-history`,
  `get-insearch-samples`, `get-broken-internal-links`, `get-broken-internal-links-history`
  отвечали `404 RESOURCE_NOT_FOUND`. Рабочие пути: `/indexing/insearch/*` →
  `/search-urls/in-search/*`, `/links/internal/{samples,history}` →
  `/links/internal/broken/{samples,history}`.
- **yandex-webmaster-mcp: 6 тулов рапортовали «0 data points» при живых данных.** API отдаёт
  ряды в трёх формах (`points`, `history`, `indicators`), а код читал только `points`.
  Разбор вынесен в `src/series.mjs` и покрыт тестами; текст теперь показывает и число точек,
  и последнее значение по каждому показателю. Затронуты `get-query-history`,
  `get-indexing-history`, `get-insearch-history`, `get-search-events-history`,
  `get-external-links-history`, `get-important-url-history` (и `get-sqi-history` — тот работал).
- **yandex-webmaster-mcp: `verify-host` называл верифицированный хост неверифицированным.**
  В ответе нет поля `verified` (есть `verification_state`), а `applicable_verifiers` — массив
  строк, а не объектов, поэтому список методов был `", , "`.
- **yandex-webmaster-mcp: `get-search-events-samples` врал про фильтр.** Параметр `event_type`
  API молча игнорирует — любое значение, включая мусорное, отдаёт одну и ту же смешанную
  выдачу. Фильтр теперь клиентский, значения enum приведены к реальным
  (`APPEARED_IN_SEARCH` / `REMOVED_FROM_SEARCH` вместо `APPEARED` / `REMOVED`), а
  ограничения пагинации описаны в тексте тула.
- **yandex-wordstat-mcp: `dynamics` с `period='daily'` не работал никогда.** Дефолтное окно
  бралось ровно 60 дней назад, а API отбивает `from` старше 60 дней (−60 отбивается, −59
  проходит). Дефолт сдвинут в границу окна.
- **yandex-wordstat-mcp: даты считались в смеси локального времени и UTC** — на UTC+7 окно
  уезжало на сутки. Теперь всё в UTC.
- **yandex-search-mcp: блок `<error>` в XML не разбирался.** Для кода 15 («ничего не
  нашлось») пустой ответ случайно совпадал с истиной, но исчерпанная квота (32) и
  недоступность поиска (33) тоже выглядели как «ничего не нашлось». Теперь всё, кроме 15,
  поднимается наверх настоящей ошибкой.
- **yandex-webmaster-mcp: `get-important-url-history` печатал бы «latest undefined».**
  Этот endpoint тоже отдаёт ключ `history`, но записи в нём — не пары `{date, value}`, а
  `{update_date, change_indicators, indexing_status, search_status}`. У него теперь свой
  форматтер (найдено ревью Codex, форма подтверждена на боевом API).
- **yandex-webmaster-mcp: `get-search-events-samples` склеивал две разные величины.**
  Рядом с отфильтрованным числом печаталось `count` — общее число событий ОБОИХ типов.
  Поле переименовано в `unfiltered_total_count`, текст говорит, что именно посчитано.
- **yandex-wordstat-mcp: округление `toDate` назад съедало целую закрытую неделю.**
  `to` = пятница давало предыдущее воскресенье, хотя неделя этой пятницы уже закрыта.
  Теперь граница тянется вперёд до конца своего периода и затем прижимается к последнему
  ЗАКРЫТОМУ (незакрытый период API отбивает 400 — проверено). Диапазон внутри одной
  недели/месяца больше не схлопывается в «пустой диапазон».
- **yandex-search-mcp: `parseFound` мог выдать фразовое число за общее.** Без
  `priority="all"` брался любой `<found>`; теперь возвращается `null`, и вызывающий код
  честно подставляет длину страницы.
- **CI: джоба тестов была зелёной всегда.** Шаг `node -e "await import(...)" &` уходил в фон,
  поэтому падение модуля не роняло джобу; в env стояли переменные, которых код не читает
  (`YANDEX_WORDSTAT_TOKEN`, `YANDEX_SEARCH_USER`, `YANDEX_SEARCH_KEY`), а `yandex-direct-mcp`
  в матрицу не входил.

### Added
- **Тесты — их не было вовсе.** 25 юнит-тестов на чистые функции (`node --test`, без сети):
  окна дат Wordstat, разбор рядов Вебмастера, парсинг XML поиска.
- **`scripts/smoke-tools.mjs`** — поднимает КАЖДЫЙ сервер по stdio, делает MCP-хендшейк и
  проверяет `tools/list`. Импортом сервер проверить нельзя: он не завершается.
- **yandex-wordstat-mcp: приведение дат к валидному окну.** Правила API (weekly начинается в
  понедельник и кончается в воскресенье, monthly охватывает целые месяцы, daily — только
  последние 59 дней) не описаны нигде и нарушение каждого возвращало сырой gRPC-текст.
  Теперь даты подтягиваются к ближайшему валидному окну, сдвиг сообщается в ответе
  (`adjustments`), а битые даты отбиваются до сети.
- **yandex-search-mcp: реальное число найденного** из `<found priority="all">` +
  человекочитаемое `<found-human>`.
- **yandex-webmaster-mcp:** `get-popular-queries` показывает окно, выбранное API
  (`date_from`/`date_to`), и общее число запросов; выдачи с `count` показывают, сколько
  всего записей за пределами страницы.

### Changed
- **BREAKING (yandex-search-mcp):** `structuredContent.totalResults` теперь означает общее
  число найденных документов, а не длину страницы. Длина страницы — в новом поле
  `returnedResults`.
- `yandex-direct-mcp` добавлен в `.mcp.json`, `plugin.mcp.json`, README и CI — пакет
  существовал, но нигде не был описан.
- README: реальный состав (5 пакетов, 91 тул вместо заявленных 4 и 40).

### Security
- **Пакеты переведены на скоуп `@stufently/*`** (решение владельца 2026-07-29). Без скоупа
  публикация ушла бы в чужой неймспейс — то есть в 403, а в худшем случае пользователи
  ставили бы чужой код по инструкции из нашего README. Добавлен
  `publishConfig.access: public` (scoped-пакеты иначе публикуются приватными),
  `yandex-direct-mcp` включён в матрицу `publish.yml`. Тег не ставился — публикации ещё нет.
- **README и `plugin.mcp.json` раздавали чужой код вместе с нашими токенами.** Имена
  `yandex-{search,wordstat,webmaster,metrika}-mcp` на npm принадлежат другому издателю
  (`altrr2`, первая публикация 2025-12-20 — за три месяца до создания этого репозитория),
  а конфиг предписывал `npx -y <имя>` и передавал в него `YANDEX_WEBMASTER_TOKEN`,
  `YANDEX_METRIKA_TOKEN`, `WORDSTAT_API_KEY`. Запуск переведён на исходники из репозитория
  во ВСЕХ местах — корневой README, README каждого пакета, `plugin.mcp.json`, `.env.example`
  и `prompt.md`, — в README добавлено предупреждение.

## 2026-07-25

### Security
- CI: `oven-sh/setup-bun` запинен по commit-SHA
  (`0c5077e51419868618aeaa5fe8019c62421857d6`, = релиз v2.2.0) в `ci.yml` и
  `publish.yml`. Тег `v2` у апстрима mutable, а джоба `publish` держит
  `NPM_TOKEN` и публикует 4 пакета с provenance — плавающая ссылка там это
  прямой supply-chain-риск. SHA = то, во что `v2` резолвился на 2026-07-25,
  поведение не меняется. First-party `actions/*` оставлены на `vN`.

## 2026-07-03

### Changed
- **yandex-wordstat-mcp 2.0.0 — migrated to Yandex Cloud Search API v2.** Yandex shut down the legacy `api.wordstat.yandex.net` (all paths 404). The server now calls `searchapi.api.cloud.yandex.net/v2/wordstat/{topRequests,dynamics,regions,getRegionsTree}` with `Authorization: Api-Key` + `folderId`. New env: `WORDSTAT_API_KEY` / `WORDSTAT_FOLDER_ID` (fallback file `~/.config/yandex-cloud/wordstat.env`); OAuth flow and `auth` subcommand removed (`src/auth.mjs` deleted). Tool names/params unchanged; request/response mapping added (devices → `DEVICE_*`, period → `PERIOD_*`, dates → RFC3339, int64 string counts → numbers, region tree `{id,label}` → `{value,label}`); `top-requests` gained a `limit` param (1-2000, default 100) and now also returns `associations`. All 5 tools verified end-to-end against the live API.


## 2026-03-16

### Added (update)
- yandex-metrika-mcp: `create-counter` and `delete-counter` tools (Management API write operations)
- yandex-metrika-mcp: `managementRequestPost` and `managementRequestDelete` helper functions
- GitHub Actions: CI workflow (lint per push/PR), publish workflow (npm on tag)
- GitHub issue templates: bug report, feature request

### Added
- Initial project setup: monorepo with 4 MCP servers
- yandex-search-mcp: 1 tool (search)
- yandex-wordstat-mcp: 5 tools + OAuth flow + rate limiting + region caching
- yandex-webmaster-mcp: 24 tools + OAuth flow + user_id caching
- yandex-metrika-mcp: 10 tools + OAuth flow
- Shared utilities pattern (fetchWithRetry, validateDate, safeJsonParse)
- Config files: .mcp.json, plugin.mcp.json, .claude-plugin/plugin.json
- Skills: yandex-keyword-research, yandex-competitive-analysis
- Biome linting/formatting config

### Updated
- Node.js engine requirement: >= 22.0.0 (LTS 24.x Krypton active)
- @modelcontextprotocol/sdk: ^1.27.1 (security fix CVE-2026-25536)
- zod: ^4.3.6
- @biomejs/biome: ^2.4.6 (resolved to 2.4.7)

### Fixed
- safeJsonParse: read body as text first, then JSON.parse (consumed body bug)
- Windows auth: use `cmd /c start` instead of `execFile('start', ...)`
- fetchWithRetry: retry on network errors (fetch rejects), not just HTTP 429/5xx
- Webmaster dateParams: explicit UTC suffix for timezone safety
- Wordstat dynamics: string/number type coercion in trend calculation
- Metrika get-counter: read from `data.counter` wrapper (API response shape)
- Retry-After: support both integer seconds and HTTP-date formats
