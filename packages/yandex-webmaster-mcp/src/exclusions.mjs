/**
 * Причины исключения страниц из поиска.
 *
 * Отдельного ресурса «исключённые страницы» в API v4 НЕТ (проверено по справочнику
 * ресурсов: https://yandex.ru/dev/webmaster/doc/ru/concepts/getting-started.md).
 * `GET /summary` отдаёт только агрегат `excluded_pages_count` — число без причин,
 * а причина по конкретному URL живёт полем `excluded_url_status` в примерах событий
 * `GET /search-urls/events/samples` у записей с `event: REMOVED_FROM_SEARCH`
 * (перечисление ApiExcludedUrlStatus: NOTHING_FOUND, HOST_ERROR, HTTP_ERROR,
 * REDIRECT_NOTSEARCHABLE, NOT_CANONICAL, NOT_MAIN_MIRROR, PARSER_ERROR,
 * ROBOTS_HOST_ERROR, ROBOTS_URL_ERROR, DUPLICATE, LOW_QUALITY, CLEAN_PARAMS,
 * NO_INDEX, OTHER).
 *
 * Поэтому «почему страницы выпали» отвечается ЭТИМ ресурсом, а не отдельной ручкой
 * «исключённые страницы», которой в v4 нет: сводкой причин по странице выдачи
 * (countExclusionReasons) и списком «URL — причина» (selectExcludedPages), а чтобы
 * набрать заказанное число исключённых страниц из смешанного потока событий —
 * обходом страниц (collectExcludedPages).
 */

/**
 * Сколько раз каждая причина встретилась в переданных примерах.
 *
 * ⚠️ Считаются ТОЛЬКО записи с `event: REMOVED_FROM_SEARCH`. Наличия
 * `excluded_url_status` недостаточно: в официальном примере ответа это поле стоит рядом
 * с `event: APPEARED_IN_SEARCH` — это прошлая причина уже вернувшейся в поиск страницы,
 * и в сводке «почему выпали» ей не место.
 *
 * @param {unknown} samples записи из `/search-urls/events/samples`
 * @returns {{status: string, count: number}[]} по убыванию частоты, при равенстве — по имени
 */
export function countExclusionReasons(samples) {
  const counts = new Map();
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample || typeof sample !== 'object') continue;
    if (sample.event !== 'REMOVED_FROM_SEARCH') continue;
    const status = sample.excluded_url_status;
    // Причина необязательна даже у исключённой страницы.
    if (typeof status !== 'string' || status === '') continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([aStatus, aCount], [bStatus, bCount]) => bCount - aCount || aStatus.localeCompare(bStatus))
    .map(([status, count]) => ({ status, count }));
}

/**
 * Человекочитаемая строка со сводкой причин — или пустая строка, если причин нет
 * (все примеры про появление страниц, либо выдача пуста).
 *
 * @param {{status: string, count: number}[]} reasons результат countExclusionReasons
 */
export function formatExclusionReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return '';
  const parts = reasons.map(({ status, count }) => `${status} ${count}`).join(', ');
  return `\nExclusion reasons on this page: ${parts}`;
}

/** Максимум записей на страницу у `/search-urls/events/samples` (справочник: «Количество записей (1-100)»). */
export const EVENTS_SAMPLES_PAGE_SIZE = 100;

/**
 * Исключённые страницы С ПРИЧИНОЙ ПО КАЖДОЙ — то, ради чего вообще ходят в этот ресурс.
 *
 * Берём только `event: REMOVED_FROM_SEARCH`; `excluded_url_status` у появившейся страницы —
 * причина ПРОШЛОГО исключения, и в списке «что выпало» ей не место (та же грабля, что у
 * countExclusionReasons). Причина необязательна даже у исключённой страницы — тогда `null`,
 * а не выдуманный `OTHER`: страница выпала, но робот причину не сообщил.
 *
 * `bad_http_status` и `target_url` по справочнику необязательны и осмысленны не для всех
 * причин (`bad_http_status` — для `HTTP_ERROR`, `target_url` — цель редиректа, канонический
 * адрес или дубль), поэтому кладутся в запись только когда реально пришли.
 *
 * @param {unknown} samples записи из `/search-urls/events/samples`
 * @returns {{url: string, reason: string|null, title?: string, event_date?: string,
 *   last_access?: string, bad_http_status?: number, target_url?: string}[]}
 */
export function selectExcludedPages(samples) {
  const pages = [];
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample || typeof sample !== 'object') continue;
    if (sample.event !== 'REMOVED_FROM_SEARCH') continue;
    if (typeof sample.url !== 'string' || sample.url === '') continue;
    const page = {
      url: sample.url,
      reason:
        typeof sample.excluded_url_status === 'string' && sample.excluded_url_status !== ''
          ? sample.excluded_url_status
          : null,
    };
    if (typeof sample.title === 'string' && sample.title !== '') page.title = sample.title;
    if (typeof sample.event_date === 'string') page.event_date = sample.event_date;
    if (typeof sample.last_access === 'string') page.last_access = sample.last_access;
    // Именно isInteger, а не `typeof === 'number'`: последний пропускает NaN и Infinity,
    // и в ответе появляется «HTTP NaN» — код статуса, которого не бывает.
    if (Number.isInteger(sample.bad_http_status)) page.bad_http_status = sample.bad_http_status;
    if (typeof sample.target_url === 'string' && sample.target_url !== '') page.target_url = sample.target_url;
    pages.push(page);
  }
  return pages;
}

/**
 * Список «URL — причина» для текста ответа. Причина идёт ПЕРВОЙ строкой значения, потому что
 * читают именно её; уточнения (`HTTP 500`, `→ target`) — только когда API их прислал.
 *
 * @param {ReturnType<typeof selectExcludedPages>} pages
 */
export function formatExcludedPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return '';
  const lines = pages.map((page) => {
    const details = [];
    // Тот же капкан, что и в selectExcludedPages: NaN — это `number`, и строка «HTTP NaN»
    // прошла бы к читателю как настоящий код ответа.
    if (Number.isInteger(page.bad_http_status)) details.push(`HTTP ${page.bad_http_status}`);
    if (page.target_url) details.push(`→ ${page.target_url}`);
    const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
    return `- ${page.url} — ${page.reason ?? 'REASON_NOT_REPORTED'}${suffix}`;
  });
  return `\nExcluded pages:\n${lines.join('\n')}`;
}

/**
 * Собрать ИМЕННО столько исключённых страниц, сколько просили.
 *
 * Серверного фильтра по типу события у ресурса нет: `limit`/`offset` листают смешанный поток
 * появившихся и исключённых страниц, а `count` считает события ОБОИХ типов. Поэтому «дай 20
 * исключённых» одним запросом не выполняется в принципе — нужен обход страниц с накоплением.
 * Именно это здесь и делается, а не «тот же вызов под другим именем».
 *
 * Сеть инжектится: `fetchPage(offset, pageSize)` → `{samples, count}`.
 *
 * ⚠️ `maxRequests` — потолок числа СТРАНИЦ (вызовов `fetchPage`), а не HTTP-запросов:
 * повторы внутри одного `fetchPage` (ретраи по 429/5xx) обходу не видны и в счётчик не
 * попадают. Поэтому и метрика в ответе называется `page_requests`, а не `requests`:
 * настоящих HTTP-вызовов может быть кратно больше.
 *
 * @param {{fetchPage: (offset: number, pageSize: number) => Promise<{samples?: unknown, count?: unknown}>,
 *   limit?: number, offset?: number, maxRequests?: number, pageSize?: number}} options
 */
export async function collectExcludedPages({
  fetchPage,
  limit = 20,
  offset = 0,
  maxRequests = 10,
  pageSize = EVENTS_SAMPLES_PAGE_SIZE,
}) {
  const collected = [];
  let cursor = offset;
  let requests = 0;
  let scannedEvents = 0;
  let totalEvents;
  let exhausted = false;

  while (collected.length < limit && requests < maxRequests) {
    const data = (await fetchPage(cursor, pageSize)) ?? {};
    requests += 1;
    if (Number.isFinite(data.count)) totalEvents = data.count;
    const all = Array.isArray(data.samples) ? data.samples : [];
    scannedEvents += all.length;

    // Идём ПОЭЛЕМЕНТНО и двигаем курсор на прочитанное, а не на всю выборку: `next_offset`
    // обязан указывать на первое НЕПРОЧИТАННОЕ событие. Прежний вариант складывал страницу
    // целиком и отсекал лишнее через `slice(0, limit)` — исключённые страницы из отсечённого
    // хвоста терялись НАВСЕГДА, потому что следующий вызов с `offset = next_offset` начинал
    // уже за ними.
    let consumed = 0;
    for (const sample of all) {
      consumed += 1;
      collected.push(...selectExcludedPages([sample]));
      if (collected.length >= limit) break;
    }
    // Пустая страница НЕ двигает курсор — без выхода по неполной странице цикл крутился бы
    // до maxRequests на одном и том же offset.
    cursor += consumed;

    if (collected.length >= limit) {
      // Предел набран. Концом потока это можно объявлять ТОЛЬКО когда страница дочитана до
      // конца и была неполной. Иначе в уже загруженной странице остался непрочитанный хвост,
      // и `exhausted: true` не просто соврал бы — он закрыл бы клиенту путь к остатку.
      exhausted = consumed === all.length && all.length < pageSize;
      break;
    }
    // Неполная страница = конец потока. Пустая страница попадает сюда же: без этого выхода
    // курсор не двигался бы и обход крутил бы maxRequests одинаковых запросов на одном offset.
    if (all.length < pageSize) {
      exhausted = true;
      break;
    }
    if (Number.isFinite(totalEvents) && cursor >= totalEvents) {
      exhausted = true;
      break;
    }
  }

  return {
    // Обрезать нечего: предел держит сам цикл — он останавливается на том событии, где
    // набралось `limit`, поэтому `collected` физически не может перерасти `limit`.
    // Прежний `slice(0, limit)` здесь стал бы мёртвым кодом.
    pages: collected,
    page_requests: requests,
    scanned_events: scannedEvents,
    next_offset: cursor,
    exhausted,
    // Общее число событий ОБОИХ типов — НЕ число исключённых страниц. Складывать их в одну
    // величину значит соврать: сколько всего исключено, ресурс не сообщает.
    total_events_both_types: totalEvents,
  };
}
