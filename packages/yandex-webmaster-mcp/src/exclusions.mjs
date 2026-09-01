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
 * Поэтому «почему страницы выпали» отвечается сводкой по СТРАНИЦЕ ВЫДАЧИ этого
 * ресурса, а не отдельным туром по несуществующей ручке.
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
