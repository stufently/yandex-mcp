/**
 * Битые внутренние ссылки: `/links/internal/broken/samples`.
 *
 * 🚨 ДВЕ ПРОБЛЕМЫ, КОТОРЫЕ ЧИНИТ ЭТОТ МОДУЛЬ.
 *
 * 1. Текст ответа был ОДНОЙ строкой «Broken internal links: 50 samples (114 total).» —
 *    ни одного URL. Сами ссылки лежали только в `structuredContent`, поэтому модель,
 *    читающая текстовый блок, видела счётчик и больше ничего: чинить нечего, спросить
 *    не о чем.
 *
 * 2. Записи бывают полугодовой давности и НИКАК не помечены. У `thaifaqs.ru` все 189
 *    записей — март 2026, с `source_last_access_date == discovery_date`: с момента
 *    обнаружения робот ссылку не перепроверял. «189 битых ссылок» читается как
 *    авария, хотя всё могло быть починено полгода назад. Живая проверка всех 258
 *    «битых» ссылок (2026-09-02) это и показала: настоящих 404 — 10, около 80% —
 *    301-редиректы. API не врёт, врёт подача.
 *
 * Поэтому дата последней проверки печатается рядом с каждым URL, а записи старше
 * порога помечаются как неперепроверенные — и в тексте, и в `structuredContent`.
 *
 * ⚠️ У поля `source_last_access_date` ИМЯ И ОПИСАНИЕ РАСХОДЯТСЯ в самом справочнике
 * Яндекса: имя говорит «источник», а описание — «дата последнего посещения роботом
 * страницы НАЗНАЧЕНИЯ ссылки» (проверено по
 * https://yandex.ru/dev/webmaster/doc/ru/reference/host-links-internal-samples,
 * 2026-09-02). Поэтому формулировки здесь нейтральные — «последняя проверка ссылки»,
 * а не «робот не перечитывал источник»: вывод про возраст записи верен при любом из
 * двух прочтений, а вывод про конкретную страницу — нет.
 */

/** Старше скольких дней запись считается неперепроверенной. */
export const BROKEN_LINK_STALE_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Сколько дней прошло от календарной даты до `now`. `null`, если дата не разобралась —
 * тогда возраст неизвестен, и притворяться, что он нулевой, нельзя.
 *
 * Счёт идёт в UTC: `YYYY-MM-DD` без зоны иначе съезжает на день в зависимости от того,
 * в какой таймзоне запущен процесс.
 */
export function daysSince(date, now) {
  if (typeof date !== 'string' || date === '') return null;
  const parsed = Date.parse(date.split('T')[0]);
  if (!Number.isFinite(parsed)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - parsed) / MS_PER_DAY);
}

/**
 * Разметить записи возрастом и признаком «Яндекс это не перепроверял».
 *
 * Поля API (проверено на боевом ответе 2026-09-02): `source_url`, `destination_url`,
 * `discovery_date`, `source_last_access_date`. Последнее — момент последней проверки
 * ссылки роботом (см. оговорку о расхождении имени и описания в шапке модуля).
 *
 * @param {unknown} links массив `links` из ответа
 * @param {{now?: Date, staleDays?: number}} [options]
 */
export function annotateBrokenLinks(links, { now = new Date(), staleDays = BROKEN_LINK_STALE_DAYS } = {}) {
  return (Array.isArray(links) ? links : [])
    .filter((link) => link && typeof link === 'object')
    .map((link) => {
      const age = daysSince(link.source_last_access_date, now);
      return {
        ...link,
        days_since_last_check: age,
        // Ровное равенство дат значит «с момента обнаружения проверок не было» — самый
        // частый и самый обманчивый случай. Пустые строки под это НЕ подпадают: `'' === ''`
        // дало бы «не перепроверяли» на записи, где дат просто нет.
        never_rechecked:
          typeof link.source_last_access_date === 'string' &&
          link.source_last_access_date !== '' &&
          typeof link.discovery_date === 'string' &&
          link.source_last_access_date === link.discovery_date,
        // `null` — возраст неизвестен: это НЕ «свежая» и не «протухшая».
        stale: age === null ? null : age > staleDays,
      };
    });
}

/**
 * Текстовый блок: счётчики, предупреждение о возрасте и САМИ ССЫЛКИ.
 *
 * @param {ReturnType<typeof annotateBrokenLinks>} links размеченные записи
 * @param {{total?: unknown, staleDays?: number}} [options]
 */
export function formatBrokenLinks(links, { total, staleDays = BROKEN_LINK_STALE_DAYS } = {}) {
  const list = Array.isArray(links) ? links : [];
  const totalText = Number.isFinite(total) ? total : 'n/a';
  const head = `Broken internal links: ${list.length} samples (${totalText} total).`;
  if (list.length === 0) return head;

  const staleCount = list.filter((link) => link.stale === true).length;
  const warning =
    staleCount > 0
      ? `\n⚠️ ${staleCount} of ${list.length} shown were last checked over ${staleDays} days ago — Yandex has not ` +
        're-verified them since, so some of these may already be fixed. Verify the URLs before acting on them.'
      : '';

  const lines = list.map((link) => {
    const details = [];
    if (link.days_since_last_check === null) details.push('last check date unknown');
    else details.push(`last checked ${link.source_last_access_date} (${link.days_since_last_check}d ago)`);
    if (link.never_rechecked) details.push('never re-checked since discovery');
    else if (link.discovery_date) details.push(`found ${link.discovery_date}`);
    if (link.stale === true) details.push('STALE');
    return `- ${link.destination_url ?? '(no destination)'} ← ${link.source_url ?? '(no source)'} (${details.join(', ')})`;
  });

  return `${head}${warning}\n${lines.join('\n')}`;
}
