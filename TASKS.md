# TODO & Tasks

## TODO

- [ ] **Решить, под какими именами публиковаться (за владельцем).** Имена
      `yandex-{search,wordstat,webmaster,metrika}-mcp` на npm заняты издателем `altrr2`
      (репо `altrr2/yandex-tools-mcp`, первая публикация 2025-12-20). `.github/workflows/publish.yml`
      публикует именно эти имена и получит 403. Варианты: скоуп `@stufently/*` либо другие имена.
      До решения `publish.yml` трогать нельзя, а README/plugin.mcp.json уже переведены на запуск
      из исходников.
- [ ] `YANDEX_DIRECT_TOKEN` недействителен (`error_code 53`) — все 43 тула Директа сейчас
      нерабочие; перевыпустить токен и прогнать по ним живой тест
- [ ] Direct: читать заголовок `Units` (расход баллов) и отдавать его в `structuredContent`
- [ ] Direct: путь захардкожен на `/json/v5`, из-за чего ЕПК (`v501`) недостижим
- [ ] Метрика: пагинация (`offset`), `accuracy`, `attribution`, `currency`; сейчас нет ни в одном туле
- [ ] Метрика: `/data/bytime`, `/data/comparison`, `/data/drilldown` (все три отвечают 200)
- [ ] Метрика: семафор под квоту (200 запросов / 5 мин, 3 одновременных, 5000/сутки);
      добавить 420 к ретраебельным статусам рядом с 429
- [ ] Search API: троттлинг (общая квота 10 rps и 10 000/час), лимитер есть только в wordstat
- [ ] Wordstat: `regions` смешивает уровни иерархии (Россия / Центр / Москва и область / Москва
      в одном списке) — проставить `depth`/`parentId` и дать фильтр по уровню
- [ ] Деструктивные тулы (`delete-counter`, `delete-host`, ставки в Директе) без dry-run
      и подтверждения
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
