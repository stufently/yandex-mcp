# Changelog

## 2026-03-16

### Added
- Initial project setup: monorepo with 4 MCP servers
- yandex-search-mcp: 1 tool (search)
- yandex-wordstat-mcp: 5 tools + OAuth flow + rate limiting + region caching
- yandex-webmaster-mcp: 24 tools + OAuth flow + user_id caching
- yandex-metrika-mcp: 10 tools + OAuth flow
- Shared utilities pattern (fetchWithRetry, validateDate, safeJsonParse)
- Config files: .mcp.json, plugin.mcp.json, .claude-plugin/plugin.json
- Skills: yandex-keyword-research, yandex-competitive-analysis
- Biome linting/formatting config

### Updated
- Node.js engine requirement: >= 22.0.0 (LTS 24.x Krypton active)
- @modelcontextprotocol/sdk: ^1.27.1 (security fix CVE-2026-25536)
- zod: ^4.3.6
- @biomejs/biome: ^2.4.6 (resolved to 2.4.7)

### Fixed
- safeJsonParse: read body as text first, then JSON.parse (consumed body bug)
- Windows auth: use `cmd /c start` instead of `execFile('start', ...)`
- fetchWithRetry: retry on network errors (fetch rejects), not just HTTP 429/5xx
- Webmaster dateParams: explicit UTC suffix for timezone safety
- Wordstat dynamics: string/number type coercion in trend calculation
- Metrika get-counter: read from `data.counter` wrapper (API response shape)
- Retry-After: support both integer seconds and HTTP-date formats
