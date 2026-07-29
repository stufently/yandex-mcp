/**
 * Разбор XML-выдачи Yandex Search API v2.
 *
 * Две вещи, из-за которых раньше терялась информация:
 *   1. <found priority="all">9949199</found> — сколько документов нашлось ВСЕГО.
 *      Мы отдавали вместо этого длину страницы (10), и модель считала, что в индексе
 *      ровно десять документов.
 *   2. <error code="N">текст</error> — блок ошибки не разбирался вообще. Для code=15
 *      («ничего не нашлось») пустой ответ случайно совпадал с истиной, а вот 32/33
 *      (превышение квоты, поиск недоступен) молча превращались в «ничего не нашлось».
 */

/** Коды, при которых пустая выдача — это нормальный ответ, а не сбой. */
export const EMPTY_RESULT_ERROR_CODES = new Set([15]);

export function cleanHtml(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

export function extractAllTags(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    results.push(m[1]);
  }
  return results;
}

/** @returns {{code: number|null, message: string}|null} */
export function parseError(xml) {
  const m = String(xml ?? '').match(/<error(?:\s+code="(\d+)")?[^>]*>([\s\S]*?)<\/error>/i);
  if (!m) return null;
  return { code: m[1] !== undefined ? Number(m[1]) : null, message: cleanHtml(m[2]) };
}

/**
 * Сколько документов нашлось всего. Яндекс отдаёт несколько <found> с разным
 * priority (`all`, `phrase`, `strict`), и только `all` — это общее число.
 * Если его нет, честнее вернуть null, чем выдать за общее число фразовое:
 * вызывающий код подставит длину страницы.
 * @returns {{total: number|null, human: string}}
 */
export function parseFound(xml) {
  const source = String(xml ?? '');
  const byPriority = source.match(/<found\s+priority="all"[^>]*>(\d+)<\/found>/i);
  const human = cleanHtml(extractTag(source, 'found-human'));
  return { total: byPriority ? Number(byPriority[1]) : null, human };
}

export function parseSearchResults(xml) {
  const groups = extractAllTags(xml, 'group');
  if (groups.length === 0) return [];

  return groups
    .map((group, i) => {
      const doc = extractTag(group, 'doc');
      if (!doc) return null;

      const url = cleanHtml(extractTag(doc, 'url'));
      let domain = '';
      try {
        domain = new URL(url).hostname;
      } catch {
        /* документ без разбираемого URL — домен оставляем пустым */
      }

      const title = cleanHtml(extractTag(doc, 'title'));
      const headline = cleanHtml(extractTag(doc, 'headline'));
      const passages = extractAllTags(doc, 'passage').map(cleanHtml).filter(Boolean);
      const snippet = [headline, ...passages].filter(Boolean).join(' ');

      const size = parseInt(extractTag(doc, 'size'), 10) || 0;
      const lang = cleanHtml(extractTag(doc, 'lang'));
      const cachedUrl = cleanHtml(extractTag(doc, 'saved-copy-url'));

      return { position: i + 1, url, domain, title, headline, passages, snippet, size, lang, cachedUrl };
    })
    .filter(Boolean);
}
