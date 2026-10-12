/**
 * The five servers and the minimum number of tools each must expose. The
 * minimum catches both "the package does not load" and "half the tools fell off
 * in a refactor". Shared by the source smoke test and the Docker smoke test.
 */
export const SERVERS = [
  ['yandex-search-mcp', 1],
  ['yandex-wordstat-mcp', 5],
  ['yandex-webmaster-mcp', 25],
  ['yandex-metrika-mcp', 10],
  ['yandex-direct-mcp', 30],
];
