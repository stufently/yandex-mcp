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
 *
 * 🚨 ГЛАВНОЕ ПРО ПРИРОДУ ДАННЫХ. `/search-urls/events/samples` — это ЛЕНТА СОБЫТИЙ ВО
 * ВРЕМЕНИ, а не текущее состояние индекса. Один и тот же URL встречается в ней и как
 * `REMOVED_FROM_SEARCH`, и позже как `APPEARED_IN_SEARCH`: страница выпала и вернулась,
 * и СЕЙЧАС она в поиске. Пока обход брал все записи `REMOVED_FROM_SEARCH` подряд, такие
 * URL попадали в «исключённые» — замер по боевому `hqdthai.ru` (500 событий): 284
 * уникальных removed, 196 appeared, и 81 URL в ОБОИХ списках, то есть до 29% выдачи
 * противоречило описанию тула. Поэтому здесь дедуп по URL с победой ПОСЛЕДНЕГО по
 * времени события; вернувшиеся отдаются отдельным полем `returned_to_search`, а не
 * выбрасываются молча — «выпала и вернулась» это реальный сигнал, просто не про
 * исключение.
 */

const REMOVED = 'REMOVED_FROM_SEARCH';
const APPEARED = 'APPEARED_IN_SEARCH';

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
    if (sample.event !== REMOVED) continue;
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

/** Календарный день из даты события (`2026-08-27T00:00:00.000+03:00` → `2026-08-27`). */
function dayOf(value) {
  return typeof value === 'string' ? value.split('T')[0] : '';
}

/**
 * Момент события в миллисекундах, `null` — если дату не разобрать.
 *
 * ⚠️ Голый `Date.parse` тут НЕДОСТАТОЧЕН: справочник Яндекса печатает даты как
 * `2016-01-01T00:00:00,000+0300` — доли секунды через ЗАПЯТУЮ и смещение без двоеточия, и
 * на такой строке `Date.parse` возвращает `NaN`. Боевой API 2026-09-02 отдаёт нормальный
 * ISO (`2026-08-27T00:00:00.000+03:00`), но полагаться на это нельзя: формат из справочника
 * лежит и в фикстурах этого пакета. Поэтому запятая и смещение нормализуются перед разбором.
 */
function eventTime(value) {
  if (typeof value !== 'string' || value === '') return null;
  const normalized = value.replace(/,(\d{3})/, '.$1').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Строго ли `candidate` позже `existing`.
 *
 * Сравниваются МОМЕНТЫ, а не строки: смещение в датах Вебмастера может отличаться, и
 * лексикографическое сравнение тогда врёт. Неразбираемая или отсутствующая дата — не повод
 * менять победителя: поток `/search-urls/events/samples` идёт СВЕЖИМИ ВПЕРЁД (проверено на
 * боевом API 2026-09-02: offset 0 → 2026-08-31, offset 400 → 2026-08-18), поэтому при
 * равенстве и при неизвестности выигрывает тот, кого увидели ПЕРВЫМ. Возврат `false` в
 * сомнительном случае — это и есть «первым увиденным».
 *
 * @param {string} candidate дата события-претендента
 * @param {string} existing дата события-держателя
 */
export function isLaterEvent(candidate, existing) {
  const a = eventTime(candidate);
  const b = eventTime(existing);
  if (a === null || b === null) return false;
  return a > b;
}

/**
 * Исключённые страницы С ПРИЧИНОЙ ПО КАЖДОЙ — то, ради чего вообще ходят в этот ресурс.
 *
 * Берём только `event: REMOVED_FROM_SEARCH`; `excluded_url_status` у появившейся страницы —
 * причина ПРОШЛОГО исключения, и в списке «что выпало» ей не место (та же грабля, что у
 * countExclusionReasons). Причина необязательна даже у исключённой страницы — тогда `null`,
 * а не выдуманный `OTHER`: страница выпала, но робот причину не сообщил.
 *
 * Поле причины называется `excluded_url_status` — ИМЕНЕМ ИЗ API, а не синонимом `reason`.
 * Пока здесь стоял `reason`, описание тула обещало одно поле, а `structuredContent` отдавал
 * другое, и соседний `get-search-events-samples` в сырых `samples` отдавал третий вариант
 * того же значения. Одно значение — одно имя, и это имя из справочника Яндекса
 * (ApiExcludedUrlStatus), чтобы его можно было грепнуть по докам.
 *
 * `bad_http_status` и `target_url` по справочнику необязательны и осмысленны не для всех
 * причин (`bad_http_status` — для `HTTP_ERROR`, `target_url` — цель редиректа, канонический
 * адрес или дубль), поэтому кладутся в запись только когда реально пришли.
 *
 * @param {unknown} samples записи из `/search-urls/events/samples`
 * @returns {{url: string, excluded_url_status: string|null, title?: string, event_date?: string,
 *   last_access?: string, bad_http_status?: number, target_url?: string}[]}
 */
export function selectExcludedPages(samples) {
  const pages = [];
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample || typeof sample !== 'object') continue;
    if (sample.event !== REMOVED) continue;
    if (typeof sample.url !== 'string' || sample.url === '') continue;
    const page = {
      url: sample.url,
      excluded_url_status:
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
 * читают именно её; уточнения (дата удаления, `HTTP 500`, `→ target`) — только когда API их
 * прислал. Дата события печатается рядом намеренно: список собран из СОБЫТИЙ за окно, и без
 * даты читатель принимает прошлогоднее удаление за сегодняшнее.
 *
 * @param {ReturnType<typeof selectExcludedPages>} pages
 */
export function formatExcludedPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return '';
  const lines = pages.map((page) => {
    const details = [];
    const day = dayOf(page.event_date);
    if (day) details.push(`removed ${day}`);
    // Тот же капкан, что и в selectExcludedPages: NaN — это `number`, и строка «HTTP NaN»
    // прошла бы к читателю как настоящий код ответа.
    if (Number.isInteger(page.bad_http_status)) details.push(`HTTP ${page.bad_http_status}`);
    if (page.target_url) details.push(`→ ${page.target_url}`);
    const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
    return `- ${page.url} — ${page.excluded_url_status ?? 'REASON_NOT_REPORTED'}${suffix}`;
  });
  return `\nExcluded pages:\n${lines.join('\n')}`;
}

/**
 * Страницы, которые в этом же окне выпали И ВЕРНУЛИСЬ. Не «мусор, который отфильтровали»:
 * возврат в поиск — самостоятельный сигнал (проблема была и ушла), поэтому он отдаётся
 * читателю, а не молча выбрасывается.
 *
 * @param {{url: string, event_date?: string, previous_excluded_url_status: string|null}[]} returned
 */
export function formatReturnedToSearch(returned) {
  if (!Array.isArray(returned) || returned.length === 0) return '';
  const lines = returned.map((entry) => {
    const details = [];
    const day = dayOf(entry.event_date);
    if (day) details.push(`returned ${day}`);
    if (entry.previous_excluded_url_status) details.push(`was ${entry.previous_excluded_url_status}`);
    const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
    return `- ${entry.url}${suffix}`;
  });
  return (
    `\nBack in search — dropped and re-appeared inside the scanned window, so NOT excluded now ` +
    `(${returned.length}):\n${lines.join('\n')}`
  );
}

/**
 * Предупреждение о том, что число исключённых страниц у `get-summary` и длина этого списка —
 * величины РАЗНОЙ ПРИРОДЫ.
 *
 * Живой замер по `hqdthai.ru` (2026-09-02): `get-summary` отдаёт `excluded_pages_count: 5`,
 * а обход событий набирает 125+ и пишет «More may remain» — расхождение в 25 раз, и до этой
 * правки ни один из двух тулов о нём не предупреждал. Причина не в ошибке: summary — текущий
 * агрегат Яндекса, а список — события удаления за просмотренное окно.
 *
 * @param {number} collected сколько исключённых страниц набрал обход
 * @param {number|null|undefined} summaryCount `excluded_pages_count` из `/summary`, если удалось получить
 */
export function formatExcludedCountNote(collected, summaryCount) {
  const nature =
    'This list is built from REMOVED_FROM_SEARCH events inside the scanned window (deduplicated per URL, ' +
    'latest event wins) — not from a live "currently excluded" index, which API v4 does not expose.';
  if (!Number.isFinite(summaryCount)) return `\n⚠️ ${nature}`;
  return `\n⚠️ ${nature} get-summary reports excluded_pages_count=${summaryCount} for this host; ${collected} here is a different kind of number and the two are not expected to match.`;
}

/**
 * Впитать одно событие в накопитель дедупа.
 *
 * @returns {number} новое число URL, у которых ПОСЛЕДНЕЕ событие — исключение
 */
function absorbEvent(seen, order, sample, excludedCount) {
  if (!sample || typeof sample !== 'object') return excludedCount;
  const { url, event } = sample;
  if (typeof url !== 'string' || url === '') return excludedCount;
  if (event !== REMOVED && event !== APPEARED) return excludedCount;
  const date = typeof sample.event_date === 'string' ? sample.event_date : '';

  const entry = seen.get(url);
  if (!entry) {
    seen.set(url, {
      latestEvent: event,
      latestDate: date,
      // Улика удаления хранится ОТДЕЛЬНО от победителя: даже когда побеждает возврат в
      // поиск, причина прошлого исключения нужна в `returned_to_search`.
      removal: event === REMOVED ? selectExcludedPages([sample])[0] : null,
      removalDate: event === REMOVED ? date : '',
    });
    order.push(url);
    return event === REMOVED ? excludedCount + 1 : excludedCount;
  }

  if (event === REMOVED && (entry.removal === null || isLaterEvent(date, entry.removalDate))) {
    entry.removal = selectExcludedPages([sample])[0];
    entry.removalDate = date;
  }
  if (!isLaterEvent(date, entry.latestDate)) return excludedCount;

  const previous = entry.latestEvent;
  entry.latestEvent = event;
  entry.latestDate = date;
  if (previous === event) return excludedCount;
  return event === REMOVED ? excludedCount + 1 : excludedCount - 1;
}

/**
 * Собрать ИМЕННО столько исключённых страниц, сколько просили.
 *
 * Серверного фильтра по типу события у ресурса нет: `limit`/`offset` листают смешанный поток
 * появившихся и исключённых страниц, а `count` считает события ОБОИХ типов. Поэтому «дай 20
 * исключённых» одним запросом не выполняется в принципе — нужен обход страниц с накоплением.
 * Именно это здесь и делается, а не «тот же вызов под другим именем».
 *
 * Накопитель — не список событий, а СОСТОЯНИЕ ПО URL: повторные события одного адреса
 * схлопываются, побеждает последнее по времени. URL, у которого последнее событие — возврат
 * в поиск, уходит из `pages` в `returned_to_search`. Гарантия честная и ровно такая, какую
 * может дать лента: «в просмотренном окне ни один URL не отдан исключённым, если внутри окна
 * он потом вернулся».
 *
 * Сеть инжектится: `fetchPage(offset, pageSize)` → `{samples, count}`.
 *
 * ⚠️ `maxRequests` — потолок числа СТРАНИЦ (вызовов `fetchPage`), а не HTTP-запросов:
 * повторы внутри одного `fetchPage` (ретраи по 429/5xx) обходу не видны и в счётчик не
 * попадают. Поэтому и метрика в ответе называется `page_requests`, а не `requests`:
 * настоящих HTTP-вызовов может быть кратно больше.
 *
 * ⚠️ ГРАНИЦА ДЕДУПА — ОДИН ВЫЗОВ. Состояние по URL живёт внутри вызова, поэтому продолжение
 * обхода с `next_offset` его не наследует: если возврат страницы в поиск попал в ПРЕДЫДУЩЕЕ
 * окно, а её удаление — в следующее, второй вызов снова объявит её исключённой. Одного
 * `offset` для склейки недостаточно, а хранить состояние между вызовами тулу негде. Поэтому
 * вызывающий может передать `knownReturned` — URL из `returned_to_search` прошлых страниц;
 * они засеиваются как «уже вернулись» и в `pages` не попадают.
 *
 * @param {{fetchPage: (offset: number, pageSize: number) => Promise<{samples?: unknown, count?: unknown}>,
 *   limit?: number, offset?: number, maxRequests?: number, pageSize?: number,
 *   knownReturned?: string[]}} options
 */
export async function collectExcludedPages({
  fetchPage,
  limit = 20,
  offset = 0,
  maxRequests = 10,
  pageSize = EVENTS_SAMPLES_PAGE_SIZE,
  knownReturned = [],
}) {
  /** @type {Map<string, {latestEvent: string, latestDate: string, removal: object|null, removalDate: string}>} */
  const seen = new Map();
  const order = [];
  // Дата пустая намеренно: `isLaterEvent` не считает НИ ОДНО событие позже неизвестной даты,
  // поэтому засеянный возврат держится до конца вызова — вызывающий утверждает факт, а не
  // предлагает гипотезу.
  for (const url of Array.isArray(knownReturned) ? knownReturned : []) {
    if (typeof url !== 'string' || url === '' || seen.has(url)) continue;
    seen.set(url, { latestEvent: APPEARED, latestDate: '', removal: null, removalDate: '' });
    order.push(url);
  }
  let excludedCount = 0;
  let cursor = offset;
  let requests = 0;
  let scannedEvents = 0;
  let totalEvents;
  let exhausted = false;

  while (excludedCount < limit && requests < maxRequests) {
    const data = (await fetchPage(cursor, pageSize)) ?? {};
    requests += 1;
    if (Number.isFinite(data.count)) totalEvents = data.count;
    const all = Array.isArray(data.samples) ? data.samples : [];

    // Идём ПОЭЛЕМЕНТНО и двигаем курсор на прочитанное, а не на всю выборку: `next_offset`
    // обязан указывать на первое НЕПРОЧИТАННОЕ событие. Прежний вариант складывал страницу
    // целиком и отсекал лишнее через `slice(0, limit)` — исключённые страницы из отсечённого
    // хвоста терялись НАВСЕГДА, потому что следующий вызов с `offset = next_offset` начинал
    // уже за ними.
    let consumed = 0;
    for (const sample of all) {
      consumed += 1;
      excludedCount = absorbEvent(seen, order, sample, excludedCount);
      if (excludedCount >= limit) break;
    }
    // Пустая страница НЕ двигает курсор — без выхода по неполной странице цикл крутился бы
    // до maxRequests на одном и том же offset.
    cursor += consumed;
    // Считаем ПРОЧИТАННОЕ, а не загруженное: остановившись на 2-м событии из 100, «scanned
    // 100» соврал бы ровно про тот хвост, который next_offset обещает отдать в следующий раз.
    scannedEvents += consumed;

    if (excludedCount >= limit) {
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

  const pages = [];
  const returnedToSearch = [];
  for (const url of order) {
    const entry = seen.get(url);
    if (entry.latestEvent === REMOVED) {
      pages.push(entry.removal);
      continue;
    }
    // Просто появившаяся страница — не новость: интересен именно возврат ПОСЛЕ выпадения,
    // поэтому URL без единого REMOVED в окне сюда не попадает.
    if (entry.removal === null) continue;
    const back = { url, previous_excluded_url_status: entry.removal.excluded_url_status };
    if (entry.latestDate) back.event_date = entry.latestDate;
    returnedToSearch.push(back);
  }

  return {
    // Обрезать нечего: предел держит сам цикл — он останавливается на том событии, где
    // набралось `limit`, поэтому `pages` физически не может перерасти `limit`.
    pages,
    // Отфильтрованное не прячется: «выпала и вернулась» — рабочий сигнал, а заодно
    // объяснение, почему исключённых меньше, чем просмотрено событий удаления.
    returned_to_search: returnedToSearch,
    page_requests: requests,
    scanned_events: scannedEvents,
    next_offset: cursor,
    exhausted,
    // Общее число событий ОБОИХ типов — НЕ число исключённых страниц. Складывать их в одну
    // величину значит соврать: сколько всего исключено, ресурс не сообщает.
    total_events_both_types: totalEvents,
  };
}
