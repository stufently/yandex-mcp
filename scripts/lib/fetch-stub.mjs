/**
 * Подмена глобального `fetch` фикстурами. Грузится через `--import`, ДО кода сервера,
 * поэтому сервер видит уже подменённый `fetch` и в сеть не ходит ни разу.
 *
 * Лежит рядом с `list-tools.mjs` и по той же причине: это общее ТУЛИНГ-хозяйство, а не
 * рантайм пакета. Каталог `test/` для него не годится ещё и технически — `node --test`
 * подхватывает оттуда ЛЮБОЙ `.mjs` как тестовый файл.
 *
 * Фикстуры приходят через env: `[{match, body, status?, end?}]`. `end: true` — совпадение
 * по КОНЦУ адреса, и такие фикстуры проверяются первыми; иначе — по вхождению, от самого
 * длинного `match` к короткому. Без этого `/v4/user` (эндпоинт `getUserId`) перехватывал бы
 * `/v4/user/1/hosts/…`, потому что он его префикс, и ответ решал бы порядок в массиве.
 */
const fixtures = JSON.parse(process.env.MCP_FETCH_FIXTURES ?? '[]').sort(
  (a, b) => (b.end ? 1 : 0) - (a.end ? 1 : 0) || String(b.match).length - String(a.match).length,
);

globalThis.fetch = async (url) => {
  const target = String(url);
  const hit = fixtures.find((fixture) =>
    fixture.end ? target.endsWith(fixture.match) : target.includes(fixture.match),
  );
  if (!hit) {
    return new Response(JSON.stringify({ error_message: `no fixture for ${target}` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(hit.body ?? {}), {
    status: hit.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
};
