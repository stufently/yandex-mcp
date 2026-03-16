# Задание: Yandex MCP — монорепо MCP-серверов для Yandex API

Написать с нуля монорепо из 4 MCP-серверов для Yandex API. Код должен быть production-ready.

## Порядок реализации

1. **Shared utilities** — общие функции (fetchWithRetry, validateDate, safe JSON parsing) для переиспользования
2. **yandex-search-mcp** — самый простой (1 tool)
3. **yandex-wordstat-mcp** — средний (5 tools, rate limiting, caching)
4. **yandex-webmaster-mcp** — самый большой (24 tools)
5. **yandex-metrika-mcp** — средний (10 tools)
6. **Конфиги и плагин** — .mcp.json, plugin.mcp.json, .claude-plugin
7. **Skills** — .claude/skills/

## Стек

- Node.js >= 22.0.0 (Active LTS: 24.x Krypton)
- Bun (менеджер пакетов, workspaces)
- Pure ES Modules (.mjs, без TypeScript, без билд-степа)
- Biome для линтинга/форматирования
- `@modelcontextprotocol/sdk` (^1.27.1) + `zod` (^4.3.6)

## Структура монорепо

```
packages/
├── yandex-search-mcp/
│   ├── src/index.mjs          # MCP сервер (1 tool)
│   ├── package.json
│   └── README.md
├── yandex-wordstat-mcp/
│   └── src/
│       ├── index.mjs          # MCP сервер (5 tools)
│       └── auth.mjs           # OAuth flow
│   ├── package.json
│   └── README.md
├── yandex-webmaster-mcp/
│   └── src/
│       ├── index.mjs          # MCP сервер (24 tools)
│       └── auth.mjs           # OAuth flow
│   ├── package.json
│   └── README.md
└── yandex-metrika-mcp/
    └── src/
        ├── index.mjs          # MCP сервер (10 tools)
        └── auth.mjs           # OAuth flow
    ├── package.json
    └── README.md

# Корневые файлы
package.json                   # workspaces: ["packages/*"]
biome.json                     # линтинг
.mcp.json                      # локальная разработка
plugin.mcp.json                # дистрибуция как плагин
.claude-plugin/plugin.json     # манифест плагина
.env.example                   # пример переменных окружения
.claude/skills/                # скиллы для Claude Code
```

---

## Обязательные требования безопасности и надёжности

Эти 7 проблем были найдены в предыдущей реализации. Каждая ДОЛЖНА быть решена:

### 1. Безопасное открытие браузера (КРИТИЧНО)

**Проблема**: `exec()` с интерполяцией строки — command injection.

**Решение**: Использовать `execFile()` или `spawn()` вместо `exec()`:
```javascript
import { execFile } from 'node:child_process';
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  execFile(cmd, [url], (err) => {
    if (err) console.warn('Could not open browser. Visit URL manually.');
  });
}
```

### 2. Не выводить токены в stdout (КРИТИЧНО)

**Проблема**: Полный токен печатается в консоль — утечка через shell history, CI logs.

**Решение**: Показывать только первые 8 символов:
```javascript
console.log(`Token: ${token.substring(0, 8)}...`);
console.log('Set this as your environment variable.');
```

### 3. Безопасный JSON parsing (СРЕДНЕ)

**Проблема**: `response.json()` без try/catch — non-JSON ответ = необработанный crash.

**Решение**: Обернуть в try/catch в функции `apiRequest()`:
```javascript
let data;
try {
  data = await response.json();
} catch (e) {
  const text = await response.text();
  throw new Error(`Invalid JSON from API: ${text.substring(0, 200)}`);
}
return data;
```

### 4. Валидация дат (СРЕДНЕ)

**Проблема**: "2025-02-30" тихо превращается в "2025-03-02".

**Решение**: Строгая валидация через Zod regex + проверка `Date`:
```javascript
function validateDate(dateStr) {
  if (!dateStr) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD.`);
  }
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  // Проверка что дата не "перескочила" (30 фев → 2 марта)
  const [y, m, day] = dateStr.split('-').map(Number);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }
  return dateStr;
}
```

### 5. XML-парсер вместо regex в search (СРЕДНЕ)

**Проблема**: Regex-парсинг XML хрупкий, ломается на edge-cases.

**Решение**: Использовать встроенный парсер или лёгкую библиотеку. Можно использовать `DOMParser` из `linkedom` или `fast-xml-parser`. Если хочешь без зависимостей — оставить regex, но добавить защитные проверки:
- Проверять наличие `rawData` в ответе
- Обернуть `Buffer.from(data.rawData, 'base64')` в try/catch
- Валидировать что XML содержит ожидаемые теги

### 6. Retry с backoff для 429/5xx (СРЕДНЕ)

**Проблема**: При 429 сервер просто бросает ошибку без retry.

**Решение**: Добавить exponential backoff:
```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        const text = await response.text();
        throw new Error(`API error (${response.status}) after ${maxRetries} retries: ${text}`);
      }
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * 2 ** attempt, 10000);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return response;
  }
}
```

### 7. Единый формат ответов — `structuredContent` везде (НИЗКО)

**Проблема**: search не возвращает `structuredContent`, остальные возвращают.

**Решение**: Все tools во всех пакетах возвращают:
```javascript
return {
  content: [{ type: 'text', text: humanReadableSummary }],
  structuredContent: rawApiData,
};
```

---

## Shared Utilities (НЕ отдельный пакет, копируются в каждый сервер)

Каждый сервер должен содержать эти утилиты внутри своего `index.mjs`. НЕ создавать shared-пакет — это усложнит npm publishing. Вместо этого каждый сервер реализует одинаковые паттерны:

### 1. fetchWithRetry(url, options, maxRetries = 3)
- Exponential backoff: 1s, 2s, 4s (cap 10s)
- Retry на 429 (Rate Limit) и 5xx (Server Error)
- Учитывать заголовок `Retry-After` если есть
- НЕ retryить 4xx (кроме 429) — это клиентские ошибки

### 2. validateDate(dateStr)
- Принимает string или undefined
- Формат: строго YYYY-MM-DD
- Проверяет календарную корректность (30 фев = ошибка)
- Возвращает строку или undefined, бросает Error при невалидном

### 3. safeJsonParse(response)
- `response.json()` обёрнут в try/catch
- При ошибке: читает `response.text()` и бросает Error с первыми 200 символами

### 4. Единый response envelope
```javascript
return {
  content: [{ type: 'text', text: humanReadableSummary }],
  structuredContent: rawApiData,  // ВСЕГДА включать
};
```

---

## API-specific Edge Cases

### Search API
- Используется **v2 API**: `searchapi.api.cloud.yandex.net/v2/web/search` (POST, JSON request, JSON response с `rawData` — base64-encoded XML)
- Это актуальный API Yandex Cloud Search, НЕ deprecated v1
- Пустые результаты: если нет `<group>` блоков в XML — вернуть пустой массив, не падать
- Невалидный base64 в `rawData` — бросить понятную ошибку
- XML без ожидаемых тегов — вернуть пустой массив с предупреждением

### Wordstat API
- Квоты: get-regions-tree = 0, top-requests = 1, dynamics = 2, regions = 2
- 429 → retry с backoff + учитывать Retry-After
- 503 → обычно quota exceeded, retry
- Кэш регионов: загружать при первом обращении, хранить на всю сессию сервера
- Flat map регионов: `Map<regionId, {label, parentId}>` для O(1) lookup

### Webmaster API
- Bootstrap: первый запрос `GET /user` → получить `user_id`, кэшировать
- `host_id` приходит URL-encoded (например `https:example.com:443`) — передавать как есть
- `sitemap_id` тоже URL-encoded — при подстановке в URL использовать `encodeURIComponent()`
- Auth header: `Authorization: OAuth {token}` (НЕ "Bearer")

### Metrika API
- Auth header: `Authorization: OAuth {token}` (НЕ "Bearer")
- Дефолтные даты: last 30 days
- Stat API может вернуть `sampled: true` в ответе — это нормально, не ошибка
- `totals` массив может быть пустым — обрабатывать gracefully
- Pagination через `limit` + `offset` (не cursor-based)

---

## Пакет 1: yandex-search-mcp

### npm: `yandex-search-mcp`

### Переменные окружения
- `YANDEX_SEARCH_API_KEY` (обязательно) — API key из Yandex Cloud
- `YANDEX_FOLDER_ID` (обязательно) — Folder ID из Yandex Cloud

### API
- URL: `https://searchapi.api.cloud.yandex.net/v2/web/search`
- Метод: POST
- Заголовки: `Authorization: Api-Key {apiKey}`, `Content-Type: application/json`
- Ответ: JSON с полем `rawData` — base64-encoded XML
- Формат ответа: `responseFormat: 'FORMAT_XML'`

### Тело запроса
```javascript
{
  query: {
    searchType: string,        // SEARCH_TYPE_RU, SEARCH_TYPE_COM, etc.
    queryText: string,
    familyMode: string,        // FAMILY_MODE_NONE / MODERATE / STRICT
    page: string,              // "0", "1", ...
    fixTypoMode: 'FIX_TYPO_MODE_ON'
  },
  sortSpec: {
    sortMode: 'SORT_MODE_BY_RELEVANCE',
    sortOrder: 'SORT_ORDER_DESC'
  },
  groupSpec: {
    groupMode: 'GROUP_MODE_DEEP',
    groupsOnPage: string,      // maxResults as string
    docsInGroup: '1'
  },
  folderId: string,
  responseFormat: 'FORMAT_XML',
  l10n: string,                // LOCALIZATION_RU, LOCALIZATION_EN, etc.
  region?: string              // optional region ID
}
```

### Определение языка
- Если в запросе есть кириллица (U+0400-U+04FF) → русский
- Маппинг searchType: ru→SEARCH_TYPE_RU, en→SEARCH_TYPE_COM, be→SEARCH_TYPE_BE, uk→SEARCH_TYPE_UK, kk→SEARCH_TYPE_KK
- Маппинг l10n: ru→LOCALIZATION_RU, en→LOCALIZATION_EN, be→LOCALIZATION_BE, uk→LOCALIZATION_UK, kk→LOCALIZATION_KK

### XML парсинг
Из base64-decoded XML извлечь:
- `<group>` → `<doc>` блоки
- Поля: url, title, headline (meta description), passages (массив `<passage>`), size, lang, saved-copy-url
- Очистка HTML entities: `&quot;`, `&amp;`, `&lt;`, `&gt;`, `&#39;`
- Удаление HTML тегов: `/<[^>]+>/g`
- Нормализация пробелов

### Tool: `search`
```javascript
inputSchema: {
  query: z.string(),
  maxResults: z.number().min(1).max(100).optional(),      // default: 10
  region: z.number().optional(),
  page: z.number().min(0).optional(),                      // default: 0
  familyMode: z.enum(['FAMILY_MODE_NONE', 'FAMILY_MODE_MODERATE', 'FAMILY_MODE_STRICT']).optional()
}
```

Возвращает массив результатов:
```javascript
{
  position: number,
  url: string,
  domain: string,    // извлечь hostname из URL
  title: string,
  headline: string,  // meta description
  passages: string[],
  snippet: string,   // headline + passages joined
  size: number,
  lang: string,
  cachedUrl: string
}
```

---

## Пакет 2: yandex-wordstat-mcp

### npm: `yandex-wordstat-mcp`

### Переменные окружения
- `YANDEX_WORDSTAT_TOKEN` (обязательно) — OAuth токен
- `YANDEX_CLIENT_ID` (опционально) — для OAuth flow
- `YANDEX_CLIENT_SECRET` (опционально) — для OAuth flow

### API
- URL: `https://api.wordstat.yandex.net`
- Метод: POST (все эндпоинты)
- Заголовки: `Content-Type: application/json; charset=utf-8`, `Authorization: Bearer {token}`

### Rate Limiting
- 10 запросов в секунду (client-side)
- Sliding window с timestamps
- Ожидание если лимит превышен

### Кэширование
- Дерево регионов кэшируется на всю сессию
- Из дерева строится flat Map<regionId, {label, parentId}> для быстрого lookup

### CLI команда
`npx yandex-wordstat-mcp auth` — запускает OAuth flow

### OAuth flow (auth.mjs)
- Authorize URL: `https://oauth.yandex.com/authorize?response_type=code&client_id={clientId}`
- Token URL: `https://oauth.yandex.com/token` (POST)
- Body: `grant_type=authorization_code&code=...&client_id=...&client_secret=...`
- Открывает браузер через `execFile()` (НЕ `exec()`)
- НЕ печатает полный токен (только первые 8 символов)

### Tool 1: `get-regions-tree` (0 квот)
```javascript
inputSchema: {
  depth: z.number().min(1).max(5).optional()  // default: 3
}
```
- Endpoint: POST `/v1/getRegionsTree`
- Возвращает: обрезанное дерево регионов {value, label, children}

### Tool 2: `get-region-children` (0 квот)
```javascript
inputSchema: {
  regionId: z.number(),
  depth: z.number().min(1).max(3).optional()  // default: 2
}
```
- Работает по кэшированному дереву, не делает запрос к API
- Возвращает: поддерево указанного региона

### Tool 3: `top-requests` (1 квота)
```javascript
inputSchema: {
  phrase: z.string(),
  regions: z.array(z.number()).optional(),
  devices: z.array(z.enum(['desktop', 'phone', 'tablet'])).optional()
}
```
- Endpoint: POST `/v1/topRequests`
- Body: `{ phrase, regions?, devices? }`
- Возвращает: `{ topRequests: [{ phrase, count }] }`

### Tool 4: `dynamics` (2 квоты)
```javascript
inputSchema: {
  phrase: z.string(),
  period: z.enum(['daily', 'weekly', 'monthly']).optional(),  // default: monthly
  fromDate: z.string().optional(),   // YYYY-MM-DD
  toDate: z.string().optional(),     // YYYY-MM-DD
  regions: z.array(z.number()).optional(),
  devices: z.array(z.enum(['desktop', 'phone', 'tablet'])).optional()
}
```
- Endpoint: POST `/v1/dynamics`
- Дефолтные даты по периоду:
  - daily: от -60 дней до вчера
  - weekly: от понедельника ~1 год назад до последнего воскресенья
  - monthly: от 1-го числа месяца год назад до последнего дня прошлого месяца
- Body: `{ phrase, period, fromDate, toDate, regions?, devices? }`
- Возвращает: `{ dynamics: [{ date, count }] }`

### Tool 5: `regions` (2 квоты)
```javascript
inputSchema: {
  phrase: z.string(),
  regions: z.array(z.number()).optional(),   // client-side фильтр
  devices: z.array(z.enum(['desktop', 'phone', 'tablet'])).optional(),
  limit: z.number().min(1).max(50).optional()  // default: 20
}
```
- Endpoint: POST `/v1/regions`
- Body: `{ phrase, devices? }` (regions НЕ отправляется в API, фильтруется на клиенте)
- Client-side: фильтрация по regionId + потомки
- Обогащение: добавляет regionName из кэшированного flat map
- Возвращает: `{ regions: [{ regionId, regionName, count, share, affinityIndex }] }`

---

## Пакет 3: yandex-webmaster-mcp

### npm: `yandex-webmaster-mcp`

### Переменные окружения
- `YANDEX_WEBMASTER_TOKEN` (обязательно)
- `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` (опционально)

### API
- URL: `https://api.webmaster.yandex.net/v4`
- Метод: GET (все эндпоинты)
- Заголовки: `Authorization: OAuth {token}` (ВАЖНО: "OAuth", не "Bearer")

### Кэширование
- `user_id` кэшируется на сессию (endpoint: GET `/user`)
- URL builder: `/user/{userId}/hosts/{hostId}/...`

### Даты
- API принимает ISO 8601 (через `new Date(date).toISOString()`)
- Использовать `validateDate()` перед конвертацией

### OAuth flow (auth.mjs)
- Authorize: `https://oauth.yandex.ru/authorize?response_type=code&client_id={clientId}`
- Token: `https://oauth.yandex.ru/token` (POST)
- Те же правила безопасности (execFile, не показывать полный токен)

### 24 Tools (все read-only)

#### Core (3 tools)
1. **get-user** — `GET /user` → `{ user_id }`
2. **list-hosts** — `GET /user/{userId}/hosts` → массив хостов `{ host_id, unicode_host_url, ascii_host_url, verified, host_data_status }`
3. **get-host** — input: `{ host_id: string }` → `GET /user/{userId}/hosts/{hostId}` → детали хоста

#### Statistics (2 tools)
4. **get-summary** — input: `{ host_id }` → `GET .../summary` → `{ sqi, searchable_pages_count, excluded_pages_count, site_problems: { FATAL, CRITICAL, POSSIBLE_PROBLEM, RECOMMENDATION } }`
5. **get-sqi-history** — input: `{ host_id, date_from?, date_to? }` → `GET .../sqi-history` → `{ points: [{ date, value }] }`

#### Diagnostics (1 tool)
6. **get-diagnostics** — input: `{ host_id }` → `GET .../diagnostics` → `{ problems: {...} }`

#### Search Queries (2 tools)
7. **get-popular-queries** — input: `{ host_id, order_by: enum('TOTAL_SHOWS','TOTAL_CLICKS'), device_type?: enum('ALL','DESKTOP','MOBILE','TABLET','MOBILE_AND_TABLET'), date_from?, date_to?, limit?(1-500, def:100), offset?(min:0) }` → `GET .../search-queries/popular?order_by=...&query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&query_indicator=AVG_CLICK_POSITION`
8. **get-query-history** — input: `{ host_id, device_type?, date_from?, date_to? }` → `GET .../search-queries/all/history?query_indicator=...`

#### Indexing (4 tools)
9. **get-indexing-history** — input: `{ host_id, date_from?, date_to? }` → `GET .../indexing/history`
10. **get-indexing-samples** — input: `{ host_id, limit?(1-100), offset? }` → `GET .../indexing/samples`
11. **get-insearch-history** — input: `{ host_id, date_from?, date_to? }` → `GET .../indexing/insearch/history`
12. **get-insearch-samples** — input: `{ host_id, limit?(1-100), offset? }` → `GET .../indexing/insearch/samples`

#### Search Events (2 tools)
13. **get-search-events-history** — input: `{ host_id, date_from?, date_to? }` → `GET .../search-urls/events/history`
14. **get-search-events-samples** — input: `{ host_id, event_type: enum('APPEARED','REMOVED'), limit?(1-100, def:10), offset? }` → `GET .../search-urls/events/samples`

#### Links (4 tools)
15. **get-external-links** — input: `{ host_id, limit?(1-100), offset? }` → `GET .../links/external/samples`
16. **get-external-links-history** — input: `{ host_id, date_from?, date_to? }` → `GET .../links/external/history`
17. **get-broken-internal-links** — input: `{ host_id, limit?(1-100), offset? }` → `GET .../links/internal/samples`
18. **get-broken-internal-links-history** — input: `{ host_id, date_from?, date_to? }` → `GET .../links/internal/history`

#### Sitemaps (3 tools)
19. **get-sitemaps** — input: `{ host_id, limit?(1-100) }` → `GET .../sitemaps`
20. **get-sitemap** — input: `{ host_id, sitemap_id: string }` → `GET .../sitemaps/{encodedSitemapId}`
21. **get-user-sitemaps** — input: `{ host_id, limit?(1-100) }` → `GET .../user-added-sitemaps`

#### Important URLs (2 tools)
22. **get-important-urls** — input: `{ host_id, limit?(1-100), offset? }` → `GET .../important-urls`
23. **get-important-url-history** — input: `{ host_id, url: string, date_from?, date_to? }` → `GET .../important-urls/history?url=...`

#### Recrawl (1 tool)
24. **get-recrawl-quota** — input: `{ host_id }` → `GET .../recrawl/quota` → `{ daily_quota, quota_remainder }`

---

## Пакет 4: yandex-metrika-mcp

### npm: `yandex-metrika-mcp`

### Переменные окружения
- `YANDEX_METRIKA_TOKEN` (обязательно) — scope: `metrika:read`
- `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` (опционально)

### API
- Management: `https://api-metrica.yandex.net/management/v1`
- Stat: `https://api-metrica.yandex.net/stat/v1`
- Метод: GET
- Заголовки: `Authorization: OAuth {token}`

### Дефолтный диапазон дат
- Если не указано: последние 30 дней (today - 30 → today)

### OAuth flow (auth.mjs)
- Authorize: `https://oauth.yandex.ru/authorize?response_type=code&client_id={clientId}`
- Token: `https://oauth.yandex.ru/token`
- Scope: `metrika:read`

### 10 Tools

#### Management (3)
1. **get-counters** — `GET /counters` → `{ counters: [{ id, name, site, status }] }`
2. **get-counter** — input: `{ counter_id: number }` → `GET /counter/{id}`
3. **get-goals** — input: `{ counter_id: number }` → `GET /counter/{id}/goals`

#### Reporting (6)
4. **get-traffic-summary** — input: `{ counter_id, date_from?, date_to? }` → metrics: `ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds`
5. **get-traffic-sources** — input: `{ counter_id, date_from?, date_to?, limit?(def:10) }` → dimension: `ym:s:trafficSource`, metrics: `ym:s:visits,ym:s:users,ym:s:bounceRate`, sort: `-ym:s:visits`
6. **get-geography** — input: `{ counter_id, date_from?, date_to?, limit?(def:10) }` → dimensions: `ym:s:regionCountry,ym:s:regionCity`, metrics: `ym:s:visits,ym:s:users`
7. **get-devices** — input: `{ counter_id, group_by?: enum('device','browser','os') def:'device', date_from?, date_to?, limit?(def:10) }` → dimension mapping: device→`ym:s:deviceCategory`, browser→`ym:s:browser`, os→`ym:s:operatingSystem`
8. **get-popular-pages** — input: `{ counter_id, date_from?, date_to?, limit?(def:10) }` → dimension: `ym:pv:URLPath`, metrics: `ym:pv:pageviews,ym:pv:users`, sort: `-ym:pv:pageviews`
9. **get-search-phrases** — input: `{ counter_id, date_from?, date_to?, limit?(def:20) }` → dimension: `ym:s:searchPhrase`, metrics: `ym:s:visits,ym:s:users`

#### Custom (1)
10. **get-report** — input: `{ counter_id, metrics: string, dimensions?: string, date_from?, date_to?, filters?: string, sort?: string, limit?(def:10) }` → Stat API `/data?...`

Stat API параметры:
- `ids` — counter ID
- `metrics` — comma-separated
- `dimensions` — comma-separated (optional)
- `date1` / `date2` — YYYY-MM-DD
- `limit` — число
- `sort` — поле с `-` для DESC
- `filters` — выражение, например `"ym:s:trafficSource=='organic'"`

---

## Конфигурационные файлы

### Root package.json
```json
{
  "name": "yandex-mcp",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.6"
  }
}
```

### biome.json
Убрать лишние overrides от неиспользуемых фреймворков (Svelte, Astro, Vue, PayloadCMS). Оставить только:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.6/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!**/node_modules", "!**/dist", "!**/build"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "javascript": {
    "formatter": { "quoteStyle": "single" }
  }
}
```

### .mcp.json (локальная разработка)
```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-search-mcp/src/index.mjs"]
    },
    "yandex-wordstat": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-wordstat-mcp/src/index.mjs"]
    },
    "yandex-webmaster": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-webmaster-mcp/src/index.mjs"]
    },
    "yandex-metrika": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-metrika-mcp/src/index.mjs"]
    }
  }
}
```

### plugin.mcp.json
```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "npx",
      "args": ["-y", "yandex-search-mcp"],
      "env": {
        "YANDEX_SEARCH_API_KEY": "${YANDEX_SEARCH_API_KEY}",
        "YANDEX_FOLDER_ID": "${YANDEX_FOLDER_ID}"
      }
    },
    "yandex-wordstat": {
      "command": "npx",
      "args": ["-y", "yandex-wordstat-mcp"],
      "env": { "YANDEX_WORDSTAT_TOKEN": "${YANDEX_WORDSTAT_TOKEN}" }
    },
    "yandex-webmaster": {
      "command": "npx",
      "args": ["-y", "yandex-webmaster-mcp"],
      "env": { "YANDEX_WEBMASTER_TOKEN": "${YANDEX_WEBMASTER_TOKEN}" }
    },
    "yandex-metrika": {
      "command": "npx",
      "args": ["-y", "yandex-metrika-mcp"],
      "env": { "YANDEX_METRIKA_TOKEN": "${YANDEX_METRIKA_TOKEN}" }
    }
  }
}
```

### .claude-plugin/plugin.json
```json
{
  "name": "yandex-mcp",
  "version": "1.0.0",
  "description": "Yandex tools for Russian/CIS markets: search, keyword research (Wordstat), webmaster analytics, and Metrika",
  "license": "MIT",
  "keywords": ["yandex", "seo", "search", "wordstat", "webmaster", "metrika", "russia", "mcp"],
  "mcpServers": "../plugin.mcp.json",
  "skills": "../.claude/skills/"
}
```

### .env.example
```
# Yandex Search API (https://console.yandex.cloud/)
YANDEX_SEARCH_API_KEY=
YANDEX_FOLDER_ID=

# Yandex Wordstat (https://oauth.yandex.com/)
YANDEX_WORDSTAT_TOKEN=

# Yandex Webmaster (https://oauth.yandex.com/)
YANDEX_WEBMASTER_TOKEN=

# Yandex Metrika (https://oauth.yandex.com/, scope: metrika:read)
YANDEX_METRIKA_TOKEN=

# Optional: for OAuth flow (npx <package> auth)
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
```

---

## Skills (Claude Code)

### .claude/skills/yandex-keyword-research/SKILL.md

```markdown
---
name: yandex-keyword-research
description: Research keywords for Russian/CIS markets using Yandex Wordstat data. Analyzes search volumes, trends over time, and regional distribution. Use when user asks about keyword research, search volumes, trending topics, or what people are searching for in Russia/CIS.
---

# Yandex Keyword Research

Research keywords and search trends for Russian and CIS markets using Yandex tools.

## Available Tools

- `mcp__yandex-wordstat__top-requests` - Find popular queries containing a keyword (costs 1 quota unit)
- `mcp__yandex-wordstat__dynamics` - Analyze search volume trends over time (costs 2 quota units)
- `mcp__yandex-wordstat__regions` - See regional distribution of search interest (costs 2 quota units)
- `mcp__yandex-wordstat__get-regions-tree` - Get region hierarchy for filtering (free)
- `mcp__yandex-search__search` - See what currently ranks in Yandex for the keyword
- `mcp__yandex-webmaster__get-popular-queries` - Check if user's site ranks for terms (requires Webmaster access)

## Workflow

1. **Get popular queries**: Start with `top-requests` to find related searches and volumes
2. **Analyze trends**: Use `dynamics` to see if interest is growing or declining
3. **Regional breakdown**: Use `regions` to find which areas have highest interest
4. **SERP analysis** (optional): Use `search` to see current ranking content
5. **Own site check** (if Webmaster configured): Check user's site performance for these terms

## Output Guidelines

- Adapt output language to match the user's language
- Present search volumes with context (high/medium/low for the market)
- Highlight trend direction (growing, stable, declining) with percentage change
- Show top 5-10 regions by volume and by affinity index
- Include actionable insights based on the data
```

### .claude/skills/yandex-competitive-analysis/SKILL.md

```markdown
---
name: yandex-competitive-analysis
description: Analyze competitors and search landscape in Russian/CIS markets using Yandex tools. Finds who ranks for keywords, identifies content gaps, and discovers ranking opportunities. Use when user asks about competitors, who ranks for something, content gaps, or SERP analysis in Russia/CIS.
---

# Yandex Competitive Analysis

Analyze competitors and find opportunities in Russian and CIS search markets.

## Available Tools

- `mcp__yandex-search__search` - Find who currently ranks for target keywords
- `mcp__yandex-wordstat__top-requests` - Understand search volume and related queries
- `mcp__yandex-wordstat__dynamics` - Track if competition is increasing over time
- `mcp__yandex-wordstat__regions` - Find underserved regional markets
- `mcp__yandex-webmaster__get-popular-queries` - Compare user's site performance (requires Webmaster)
- `mcp__yandex-webmaster__get-summary` - Get user's site health metrics (requires Webmaster)

## Workflow

1. **Search landscape**: Use `search` to find top 10-20 results for target keywords
2. **Volume analysis**: Use `top-requests` to understand search demand
3. **Trend analysis**: Use `dynamics` to see if market is growing
4. **Regional opportunities**: Use `regions` to find high-affinity, underserved regions
5. **Own position** (if Webmaster): Compare user's ranking vs competitors

## Analysis Framework

When analyzing competitors:
- **Domain authority signals**: Identify recurring domains in top positions
- **Content patterns**: Note content types that rank (articles, products, forums)
- **Gap opportunities**: Keywords with high volume but weak competition
- **Regional gaps**: Regions with high affinity but low competition

## Output Guidelines

- Adapt output language to match the user's language
- Present competitor domains with their ranking positions
- Highlight content gaps and opportunities clearly
- Provide actionable recommendations
- Include regional opportunities if relevant
```

---

## Общий паттерн MCP сервера

Все серверы следуют одному паттерну:

```javascript
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// CLI routing
const command = process.argv[2];
if (command === 'auth') {
  const { runAuth } = await import('./auth.mjs');
  await runAuth();
} else {
  await runServer();
}

async function runServer() {
  // Validate env vars at startup
  function getToken() {
    const token = process.env.YANDEX_XXX_TOKEN;
    if (!token) throw new Error('YANDEX_XXX_TOKEN is required...');
    return token;
  }

  // Centralized API request with safe JSON parsing + retry
  async function apiRequest(baseUrl, endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const response = await fetchWithRetry(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `OAuth ${getToken()}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    // Safe JSON parsing
    let data;
    try {
      data = await response.json();
    } catch (e) {
      const text = await response.text();
      throw new Error(`Invalid JSON from API: ${text.substring(0, 200)}`);
    }
    return data;
  }

  const server = new McpServer({ name: 'yandex-xxx', version: '1.0.0' });

  // Register tools...
  server.registerTool('tool-name', {
    title: 'Tool Title',
    description: 'Tool description',
    inputSchema: { /* Zod schemas */ },
  }, async (params) => {
    const data = await apiRequest(...);
    return {
      content: [{ type: 'text', text: humanReadableSummary }],
      structuredContent: data,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Server running on stdio');
}
```

### Package.json шаблон для каждого пакета
```json
{
  "name": "yandex-xxx-mcp",
  "version": "1.0.0",
  "description": "...",
  "type": "module",
  "main": "src/index.mjs",
  "bin": { "yandex-xxx-mcp": "src/index.mjs" },
  "files": ["src/*.mjs", "README.md", "LICENSE"],
  "scripts": { "start": "node src/index.mjs" },
  "engines": { "node": ">=22.0.0" },
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^4.3.6"
  }
}
```

---

## Чеклист перед завершением

- [ ] Все 4 пакета реализованы со всеми tools
- [ ] `execFile()` вместо `exec()` в auth.mjs
- [ ] Токены НЕ печатаются полностью в stdout
- [ ] `response.json()` обёрнут в try/catch во всех пакетах
- [ ] Даты валидируются (формат + календарная корректность)
- [ ] XML парсинг в search защищён от ошибок
- [ ] Retry с backoff для 429/5xx
- [ ] Все tools возвращают `structuredContent`
- [ ] Rate limiter в wordstat (10 req/sec)
- [ ] Кэширование regions tree в wordstat
- [ ] Кэширование user_id в webmaster
- [ ] Biome конфиг без лишних overrides
- [ ] `bun install` работает
- [ ] `bun run lint` проходит без ошибок
