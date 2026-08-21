/**
 * TSV parsing for the Yandex Direct Reports API.
 *
 * Summary ("Total" / "Итого") rows are suppressed at the source by the
 * `skipReportSummary: true` request header, and the language of the response is
 * pinned with `Accept-Language`. Both matter, because the previous approach —
 * dropping any line starting with the literal `Total` or `Итого` — was wrong in
 * both directions:
 *
 *   - it silently deleted real data rows whose first column happened to start
 *     that way (a campaign named "Total Sales Q1", an ad group "Итоговая
 *     распродажа"), and
 *   - it missed the summary row in every other interface language Direct can
 *     answer in (Turkish "Toplam", Ukrainian "Разом", ...).
 *
 * No line is dropped here at all. A short line is padded with empty strings,
 * which is what the previous parser did for missing trailing cells anyway.
 * Dropping short lines instead would have replaced one silent-data-loss bug
 * with another, just triggered by a different shape of input.
 */

export const MAX_REPORT_ROWS = 500;

/**
 * @param {string} tsv raw TSV body
 * @param {{maxRows?: number}} [options]
 * @returns {Array<Record<string, string>>}
 */
export function parseTsv(tsv, { maxRows = MAX_REPORT_ROWS } = {}) {
  let text = typeof tsv === 'string' ? tsv : '';

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Tolerate CRLF from the API without leaving \r glued to the last column.
  const lines = text
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.trim() !== '');

  if (lines.length === 0) return [];

  const headers = lines[0].split('\t');
  const rows = [];

  for (let i = 1; i < lines.length && rows.length < maxRows; i++) {
    const values = lines[i].split('\t');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}
