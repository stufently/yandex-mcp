/**
 * Печать значений, которых может не быть.
 *
 * 🚨 ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. По всему серверу стоял шаблон `value || 'N/A'`, и он
 * ЛОЖНО-ОТРИЦАТЕЛЕН ровно на нуле — а ноль здесь везде значимая величина:
 *
 *   - `sqi: 0` — приговор качеству сайта, а печатался как «данных нет» (боевой прогон
 *     2026-09-02: все 13 FAQ-сайтов и `hqdphangan` показали «SQI: N/A», при этом
 *     `structuredContent` в том же ответе честно отдавал `"sqi": 0`);
 *   - `quota_remainder: 0` — квота переобхода ИСЧЕРПАНА, а читалось как «неизвестно»,
 *     то есть самый дорогой из трёх случаев: агент видит «N/A» и идёт ставить URL в
 *     очередь, которой нет;
 *   - `urls_count: 0` — пустой sitemap, тоже настоящий диагноз.
 *
 * Обратная сторона того же шаблона — `value || 0`: ОТСУТСТВИЕ поля печаталось нулём,
 * то есть «страниц в поиске нет» вместо «данные не пришли». Поэтому здесь два разных
 * инструмента, и выбор между ними — это утверждение о смысле пропуска:
 *   `orNA`   — пропуск значит «неизвестно» (поля верхнего уровня ответа);
 *   `?? 0`   — пропуск значит «ноль» (счётчики `site_problems`: API не присылает
 *              степень, по которой проблем нет).
 */

/**
 * Значение как есть; `N/A` — только когда его действительно нет.
 *
 * `null`/`undefined`/пустая строка — «нет данных». Ноль, `false` и `NaN` — данные:
 * `NaN` печатается как `NaN` намеренно, потому что это поломка ответа, а не пропуск,
 * и прятать её под «N/A» значит терять сигнал.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function orNA(value) {
  if (value === undefined || value === null || value === '') return 'N/A';
  return String(value);
}

/**
 * Сводка по хосту: ИКС, страницы, проблемы.
 *
 * @param {unknown} data ответ `/summary`
 */
export function formatSummary(data) {
  const summary = data && typeof data === 'object' ? data : {};
  const problems = summary.site_problems && typeof summary.site_problems === 'object' ? summary.site_problems : {};
  return (
    `SQI: ${orNA(summary.sqi)} | Searchable: ${orNA(summary.searchable_pages_count)} | ` +
    `Excluded: ${orNA(summary.excluded_pages_count)}\n` +
    `Problems: FATAL=${problems.FATAL ?? 0}, CRITICAL=${problems.CRITICAL ?? 0}, ` +
    `POSSIBLE=${problems.POSSIBLE_PROBLEM ?? 0}, RECOMMENDATION=${problems.RECOMMENDATION ?? 0}`
  );
}

/**
 * Список хостов — С `host_id` В КАЖДОЙ СТРОКЕ.
 *
 * `host_id` обязателен во ВСЕХ остальных тулах пакета, а текст ответа его не показывал:
 * видны были только человеческие URL, и формат (`https:example.com:443`) приходилось
 * угадывать по документации — при том, что в `structuredContent` он лежал всё это время.
 * Угаданный идентификатор — это лишний круг «404 → почитать доку → переспросить».
 *
 * @param {unknown} hosts массив `hosts` из `/user/{id}/hosts`
 */
export function formatHostList(hosts) {
  const list = Array.isArray(hosts) ? hosts : [];
  if (list.length === 0) return '0 hosts.';
  const lines = list.map((host) => {
    const entry = host && typeof host === 'object' ? host : {};
    const label = entry.unicode_host_url || entry.ascii_host_url || entry.host_id || '(no url)';
    const state = entry.verified ? 'verified' : 'unverified';
    return `- ${label} [${state}] host_id: ${orNA(entry.host_id)}`;
  });
  return `${list.length} hosts:\n${lines.join('\n')}`;
}

/**
 * Карточка sitemap. `urls_count: 0` — «файл пуст», а не «неизвестно».
 *
 * @param {string} sitemapId
 * @param {unknown} data ответ `/sitemaps/{id}`
 */
export function formatSitemap(sitemapId, data) {
  const sitemap = data && typeof data === 'object' ? data : {};
  return `Sitemap: ${sitemapId}\nURLs: ${orNA(sitemap.urls_count)}\nLast checked: ${orNA(sitemap.last_check_date)}`;
}

/**
 * Квота переобхода. Ноль остатка называется вслух: это единственное состояние, в котором
 * `add-recrawl-url` заведомо не сработает, и молча выдавать его за «N/A» дороже всего.
 *
 * @param {unknown} data ответ `/recrawl/quota`
 */
export function formatRecrawlQuota(data) {
  const quota = data && typeof data === 'object' ? data : {};
  const exhausted = quota.quota_remainder === 0 ? ' Quota is exhausted — add-recrawl-url will fail today.' : '';
  return `Recrawl quota: ${orNA(quota.daily_quota)} daily, ${orNA(quota.quota_remainder)} remaining.${exhausted}`;
}
