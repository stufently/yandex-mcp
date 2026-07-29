/**
 * Временные ряды Вебмастера приходят в ТРЁХ разных формах, и это не документировано:
 *
 *   { points: [{date, value}] }                       — /sqi-history
 *   { history: [{date, value}] }                      — /search-urls/in-search/history
 *   { indicators: { NAME: [{date, value}], ... } }     — большинство остальных
 *
 * Раньше все тулы читали только `points`, поэтому шесть из них рапортовали
 * «0 data points» при живых данных (проверено на боевом API 2026-07-29).
 * Здесь один разбор на всех: сначала ряды, потом человекочитаемая строка.
 */

function normalizePoints(raw) {
  return raw
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const value = Number(p.value);
      return {
        // Даты приходят с московским смещением (2026-07-22T00:00:00.000+03:00) —
        // берём календарный день так, как его понимает сам Вебмастер.
        date: String(p.date ?? '').split('T')[0],
        value: Number.isFinite(value) ? value : p.value,
      };
    });
}

/**
 * @returns {{name: string|null, points: {date: string, value: unknown}[]}[]}
 *   Ряды в порядке появления. Пустой массив, если рядов нет вовсе.
 */
export function extractSeries(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.points)) return [{ name: null, points: normalizePoints(data.points) }];
  if (Array.isArray(data.history)) return [{ name: null, points: normalizePoints(data.history) }];
  if (data.indicators && typeof data.indicators === 'object' && !Array.isArray(data.indicators)) {
    return Object.entries(data.indicators)
      .filter(([, points]) => Array.isArray(points))
      .map(([name, points]) => ({ name, points: normalizePoints(points) }));
  }
  return [];
}

/**
 * Сводка истории важного URL. Этот endpoint тоже отдаёт ключ `history`, но
 * записи в нём — НЕ пары {date, value}: там `update_date`, `change_indicators`,
 * `indexing_status`, `search_status` (проверено на боевом API 2026-07-29).
 * Пропускать их через formatSeries нельзя — получится «latest undefined on».
 */
export function formatUrlHistory(label, data) {
  const entries = Array.isArray(data?.history) ? data.history : [];
  if (entries.length === 0) return `${label}: no changes recorded.`;

  const last = entries[entries.length - 1];
  const when = String(last.update_date ?? '').split('T')[0] || 'unknown date';
  const changed = Array.isArray(last.change_indicators) ? last.change_indicators.join(', ') : '';
  const status = last.indexing_status?.status ? `, indexing ${last.indexing_status.status}` : '';
  return `${label}: ${entries.length} changes, latest ${when}${changed ? ` (${changed})` : ''}${status}.`;
}

/** Человекочитаемая сводка ряда: сколько точек и какая последняя. */
export function formatSeries(label, data) {
  const series = extractSeries(data);
  if (series.length === 0) return `${label}: no data points.`;

  const parts = series.map(({ name, points }) => {
    const prefix = name ? `${name}: ` : '';
    if (points.length === 0) return `${prefix}0 points`;
    const last = points[points.length - 1];
    return `${prefix}${points.length} points (latest ${last.value} on ${last.date})`;
  });
  return `${label}: ${parts.join(' | ')}`;
}
