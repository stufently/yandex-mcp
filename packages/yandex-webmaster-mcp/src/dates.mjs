/**
 * Date handling for the Yandex Webmaster API.
 *
 * The API takes ISO-8601 instants, while the tools take calendar days
 * (YYYY-MM-DD). Mapping `date_to` onto midnight of that day made the range end
 * the instant the day BEGAN, so the whole final day was excluded: asking for
 * 2026-08-01 → 2026-08-21 quietly returned data through 2026-08-20 only. The
 * loss was invisible because the API answers 200 with a shorter series.
 *
 * `date_to` is therefore mapped to the END of the requested day, which is what
 * an inclusive calendar range means to a caller.
 */

/**
 * @param {string|undefined} dateStr
 * @returns {string|undefined} the same string, once proven a real calendar date
 */
export function validateDate(dateStr) {
  if (!dateStr) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD.`);
  }
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  const [y, m, day] = dateStr.split('-').map(Number);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }
  return dateStr;
}

/** Start of the given UTC day, as an ISO instant. */
export function startOfDayIso(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

/** End of the given UTC day, as an ISO instant. */
export function endOfDayIso(dateStr) {
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

/**
 * Build `date_from` / `date_to` query params for an inclusive day range.
 *
 * @param {string} [dateFrom] YYYY-MM-DD
 * @param {string} [dateTo] YYYY-MM-DD
 * @returns {{date_from?: string, date_to?: string}}
 */
export function dateParams(dateFrom, dateTo) {
  const params = {};
  const vFrom = validateDate(dateFrom);
  const vTo = validateDate(dateTo);

  if (vFrom && vTo && vFrom > vTo) {
    throw new Error(`date_from (${vFrom}) is after date_to (${vTo}).`);
  }

  if (vFrom) params.date_from = startOfDayIso(vFrom);
  if (vTo) params.date_to = endOfDayIso(vTo);
  return params;
}
