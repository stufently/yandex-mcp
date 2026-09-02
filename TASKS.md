# TODO & Tasks

## TODO

- [ ] **Опубликовать первый релиз в скоуп `@stufently/*`** (за владельцем: нужен `NPM_TOKEN`
      с правом на скоуп в секретах репо). Имена уже переименованы, `publish.yml` готов,
      публикация идёт по тегу `v*.*.*` — тег сознательно НЕ ставился. Без скоупа публиковать
      нельзя: неймспейсы `yandex-{search,wordstat,webmaster,metrika}-mcp` принадлежат издателю
      `altrr2` (репо `altrr2/yandex-tools-mcp`, первая публикация 2025-12-20).
      Упаковка проверена 2026-08-21 (`npm pack --dry-run` по всем пяти): манифесты полные
      (`keywords`/`homepage`/`bugs`/`author` добавлены), шебанги на месте, тарболлы верные.
      Осталось ровно три шага владельца: (1) granular `NPM_TOKEN` с read/write на скоуп И
      включённым «Bypass 2FA» (без него неинтерактивный `npm publish` из CI упадёт) в секреты
      репо, (2) `git tag v2.2.0 && git push --tags`. Версии пяти пакетов уже выровнены на
      `2.2.0` (2026-08-21), тег обязан совпасть с ними.
- [ ] После первого релиза перейти на npm trusted publishing (OIDC) и убрать долгоживущий
      `NPM_TOKEN` — `id-token: write` в `publish.yml` уже стоит.
- [ ] Версия плагина живёт в `.claude-plugin/plugin.json` и закреплена на `1.0.0`; повышать её
      на каждом релизе, иначе установленный плагин не обновится у пользователей.
- [ ] `YANDEX_DIRECT_TOKEN` недействителен (`error_code 53`) — все 43 тула Директа сейчас
      нерабочие; перевыпустить токен и прогнать по ним живой тест
- [ ] Вебмастер: `get-important-url-history` объявляет и отправляет `date_from`/`date_to`,
      хотя эндпоинт `/important-urls/history` принимает только `url` — параметры уходят
      впустую и вводят в заблуждение. Найдено ревью 2026-08-21, НЕ чинилось (правка меняет
      контракт тула, а не упаковку). Проверить по докам и либо убрать из схемы, либо
      объяснить в описании.
      **Проверено по докам 2026-09-01 — замечание верное:** справочник «Получение истории
      изменений важной страницы» описывает у `/important-urls/history` РОВНО один
      query-параметр `url` (обязательный, RFC 3986), никаких `date_from`/`date_to`.
      Осталось решить, убирать их из схемы (ломает вызовы, которые их передают) или
      оставить с честным «игнорируются» в описании.
- [ ] Вебмастер: `packages/yandex-webmaster-mcp/SKILL.md` (заведён 2026-09-01 по прямой просьбе
      владельца именно по этому пути) агентам АВТОМАТИЧЕСКИ не доставляется: плагин тянет навыки
      только из `.claude/skills/`, а npm-пакет везёт лишь `src/*.mjs`, README и LICENSE
      (`files` в package.json). Решить, как подключать: копия/симлинк в `.claude/skills/yandex-webmaster/`
      (тогда появляется второй источник правды — нежелательно) либо добавить `SKILL.md` в `files`
      и в состав плагина. Копию БЕЗ решения не заводил намеренно.
- [ ] Вебмастер: `add-sitemap` на 409 `SITEMAP_ALREADY_ADDED` падает исключением, как и любой
      не-2xx (общий `apiRequestPost`). Существующий `sitemap_id` при этом виден только в тексте
      ошибки. Полезно отдавать его структурно (`already_present: true` + `sitemap_id`) — это же
      чинит случай «первый POST прошёл, повтор после сетевого сбоя получил 409». Не сделано:
      правка трогает общий POST-клиент, а сетевых тестов в пакете нет.
- [ ] Вебмастер: у `/search-urls/events/samples` нет параметра периода — окно задаётся только
      через `limit`/`offset`, поэтому «исключено ли это ПРЯМО СЕЙЧАС» тул подтвердить не может
      даже после дедупа по URL (02.09.2026): исключение старше просмотренного окна в выдачу не
      попадёт. Единственная сверка — агрегат `excluded_pages_count` из `get-summary`, который
      тул теперь отдаёт рядом (`summary_excluded_pages_count`) с явным «числа разной природы».
      Появится у Яндекса ресурс текущих исключений — переделать на него.
- [ ] Вебмастер: `get-excluded-pages` обходит смешанный поток событий линейно, потому что
      серверного фильтра по типу события у `/search-urls/events/samples` нет. На сайте, где
      исключённых мало, а появившихся много, потолок `max_requests` упирается раньше, чем
      набирается `limit`. Смягчить нечем в рамках API v4 (ресурса «исключённые страницы» не
      существует); если Яндекс заведёт фильтр — переделать на один вызов. Пока это
      задокументировано в `SKILL.md` и видно по `exhausted: false` + `next_offset`.
      NB (02.09, ревью): `max_requests` считает СТРАНИЦЫ, а не HTTP-вызовы — ретраи внутри
      `fetchWithRetry` (до 4 на страницу) в счёт не идут, метрика ответа `page_requests`.
      Общий бюджет HTTP-вызовов на уровне `fetchWithRetry` не заводился; понадобится жёсткий
      потолок сетевых обращений — делать там, а не в обходе.
- [ ] Direct: читать заголовок `Units` (расход баллов) и отдавать его в `structuredContent`
- [ ] Direct: путь захардкожен на `/json/v5`, из-за чего ЕПК (`v501`) недостижим
- [ ] Метрика: пагинация (`offset`), `accuracy`, `attribution`, `currency`; сейчас нет ни в одном туле
- [ ] Метрика: `/data/bytime`, `/data/comparison`, `/data/drilldown` (все три отвечают 200)
- [ ] Метрика: семафор под квоту (200 запросов / 5 мин, 3 одновременных, 5000/сутки);
      добавить 420 к ретраебельным статусам рядом с 429
- [ ] Search API: троттлинг (общая квота 10 rps и 10 000/час), лимитер есть только в wordstat
- [ ] Wordstat: `regions` смешивает уровни иерархии (Россия / Центр / Москва и область / Москва
      в одном списке) — проставить `depth`/`parentId` и дать фильтр по уровню
- [ ] Dry-run для пишущих тулов Директа: подтверждение (`confirm: true`) закрыто 2026-08-21 по
      всем 14 необратимым тулам, но предпросмотра «что именно изменится» по-прежнему нет —
      модель подтверждает вслепую, по своему же JSON. Полезно для `update_*` и ставок, где
      прежнее значение не восстановить. Отдельная задача, не блокирует
- [ ] Upgrade Node.js to 26.x when released (~April-May 2026), update engines in all package.json
- [x] Add CI/CD pipeline (GitHub Actions)
- [x] Add unit tests (2026-07-29: 25 тестов на чистые функции + smoke по всем серверам)
- [ ] Add integration tests with real API keys
- [ ] Harden auth flow: add state, PKCE, explicit redirect_uri, explicit scopes per service

## Completed

| Task | Date |
|------|------|
| Update dependency versions to latest (March 2026) | 2026-03-16 |
| Initialize monorepo structure | 2026-03-16 |
| Implement yandex-search-mcp (1 tool) | 2026-03-16 |
| Implement yandex-wordstat-mcp (5 tools + auth) | 2026-03-16 |
| Implement yandex-webmaster-mcp (24 tools + auth) | 2026-03-16 |
| Implement yandex-metrika-mcp (10 tools + auth) | 2026-03-16 |
| Create config files & skills | 2026-03-16 |
| Fix Codex review: safeJsonParse, Windows auth, network retry | 2026-03-16 |
| Fix Opus review: UTC dates, type coercion | 2026-03-16 |
| Fix Codex review #3: metrika get-counter response shape, Retry-After date parsing | 2026-03-16 |
| Add README.md for root and all 4 packages | 2026-03-16 |
| Add create-counter and delete-counter to yandex-metrika-mcp | 2026-03-16 |
