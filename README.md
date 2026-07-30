# Yandex MCP

A monorepo of MCP (Model Context Protocol) servers for Yandex APIs. Provides AI assistants with access to Yandex Search, Wordstat, Webmaster, Metrika, and Direct through a unified interface.

Built for Russian and CIS market analysis -- keyword research, search analytics, site monitoring, web traffic insights, and ad campaign management.

## Packages

| Package | Description | Tools |
|---------|-------------|-------|
| [yandex-search-mcp](packages/yandex-search-mcp) | Yandex Search API v2 (Cloud) | 1 |
| [yandex-wordstat-mcp](packages/yandex-wordstat-mcp) | Yandex Wordstat (Cloud Search API v2) -- keyword research | 5 |
| [yandex-webmaster-mcp](packages/yandex-webmaster-mcp) | Yandex Webmaster API v4 -- site analytics | 30 |
| [yandex-metrika-mcp](packages/yandex-metrika-mcp) | Yandex Metrika API -- web analytics | 12 |
| [yandex-direct-mcp](packages/yandex-direct-mcp) | Yandex Direct API v5 -- ad campaigns | 43 |

**91 tools total** across all packages (counted by `node scripts/smoke-tools.mjs`).

> **Package names.** These packages are published under the **`@stufently/*` scope**
> (`@stufently/yandex-webmaster-mcp` and so on). The *unscoped* names — `yandex-search-mcp`,
> `yandex-wordstat-mcp`, `yandex-webmaster-mcp`, `yandex-metrika-mcp` — belong to a
> **different publisher** on the public registry (`altrr2`,
> [altrr2/yandex-tools-mcp](https://github.com/altrr2/yandex-tools-mcp), first published
> 2025-12-20, three months before this repo existed). Never `npx` an unscoped name with your
> Yandex tokens in the environment: that hands your credentials to unrelated code. Nothing has
> been published to the scope yet, so for now run the servers from source, as shown below.

## Quick Start

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/stufently/yandex-mcp.git
cd yandex-mcp
bun install
```

2. Set environment variables (see below).

3. For packages that require OAuth tokens (Webmaster, Metrika), run the auth flow:

```bash
node packages/yandex-webmaster-mcp/src/index.mjs auth
node packages/yandex-metrika-mcp/src/index.mjs auth
```

Wordstat no longer uses OAuth: since v2.0 it talks to Yandex Cloud Search API v2 and needs a service-account API key (`WORDSTAT_API_KEY`) + folder ID (`WORDSTAT_FOLDER_ID`) — see [packages/yandex-wordstat-mcp](packages/yandex-wordstat-mcp).

## Configuration

### For MCP clients (Claude Desktop, etc.)

Point the client at a checkout of this repo — see `plugin.mcp.json`, which uses absolute
paths via `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "yandex-webmaster": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/packages/yandex-webmaster-mcp/src/index.mjs"],
      "env": { "YANDEX_WEBMASTER_TOKEN": "${YANDEX_WEBMASTER_TOKEN}" }
    }
  }
}
```

### For local development

The `.mcp.json` file runs servers directly from source with a shared `.env` file:

```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-search-mcp/src/index.mjs"]
    },
    "yandex-wordstat": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-wordstat-mcp/src/index.mjs"]
    },
    "yandex-webmaster": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-webmaster-mcp/src/index.mjs"]
    },
    "yandex-metrika": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-metrika-mcp/src/index.mjs"]
    },
    "yandex-direct": {
      "command": "node",
      "args": ["--env-file=.env", "packages/yandex-direct-mcp/src/index.mjs"]
    }
  }
}
```

## Environment Variables

| Variable | Required by | Description |
|----------|-------------|-------------|
| `YANDEX_SEARCH_API_KEY` | yandex-search-mcp | API key from [Yandex Cloud](https://console.yandex.cloud/) |
| `YANDEX_FOLDER_ID` | yandex-search-mcp | Folder ID from Yandex Cloud |
| `WORDSTAT_API_KEY` | yandex-wordstat-mcp | Yandex Cloud API key (service account, role `search-api.webSearch.user`) |
| `WORDSTAT_FOLDER_ID` | yandex-wordstat-mcp | Yandex Cloud folder ID for Search API v2 |
| `YANDEX_WEBMASTER_TOKEN` | yandex-webmaster-mcp | OAuth token for Webmaster |
| `YANDEX_METRIKA_TOKEN` | yandex-metrika-mcp | OAuth token for Metrika (scope: `metrika:read`) |
| `YANDEX_DIRECT_TOKEN` | yandex-direct-mcp | OAuth token for Direct API v5 |
| `YANDEX_DIRECT_CLIENT_LOGIN` | yandex-direct-mcp (agencies) | Client login to act on behalf of |
| `YANDEX_DIRECT_SANDBOX` | yandex-direct-mcp (optional) | `true` to hit the Direct sandbox |
| `YANDEX_CLIENT_ID` | OAuth flow (optional) | Yandex OAuth app client ID |
| `YANDEX_CLIENT_SECRET` | OAuth flow (optional) | Yandex OAuth app client secret |

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

## Skills

This project includes Claude Code skills for common workflows:

### yandex-keyword-research

Research keywords and search trends for Russian/CIS markets. Combines Wordstat data (volumes, trends, regional distribution) with Yandex Search results for a complete keyword analysis.

### yandex-competitive-analysis

Analyze competitors and search landscape. Finds who ranks for target keywords, identifies content gaps, and discovers ranking opportunities across Russian/CIS markets.

## Development

Requires Node.js >= 22.0.0 and [Bun](https://bun.sh/) as the package manager.

```bash
# Install dependencies
bun install

# Lint
bun run lint

# Auto-fix lint issues
bun run lint:fix

# Format code
bun run format

# Unit tests (pure helpers: date windows, series extraction, XML parsing)
bun run test

# Smoke test: start every server over stdio and query tools/list
bun run smoke
```

### Tech Stack

- Pure ES Modules (`.mjs`, no TypeScript, no build step)
- `@modelcontextprotocol/sdk` (^1.27.1)
- `zod` (^4.3.6) for input validation
- [Biome](https://biomejs.dev/) for linting and formatting

### Project Structure

```
packages/
  yandex-search-mcp/       # 1 tool   - Yandex Search  (src/parse.mjs — XML parsing)
  yandex-wordstat-mcp/     # 5 tools  - Keyword research (src/dates.mjs — API window rules)
  yandex-webmaster-mcp/    # 30 tools - Site analytics  (src/series.mjs — time series shapes)
  yandex-metrika-mcp/      # 12 tools - Web analytics
  yandex-direct-mcp/       # 43 tools - Ad campaigns
scripts/smoke-tools.mjs    # Starts every server and checks tools/list
.claude/skills/            # Claude Code skills
.mcp.json                  # Local dev config
plugin.mcp.json            # Distribution config
.claude-plugin/            # Plugin manifest
```

Each package keeps its pure, testable helpers in separate modules next to `index.mjs`;
tests live in `packages/*/test/*.test.mjs` and run without network access.

## Contributing

Contributions are welcome. Please ensure:

1. Code passes `bun run lint` and `bun run test` with no errors.
2. All tools return both `content` (human-readable) and `structuredContent` (raw API data).
3. The `content` text must not contradict `structuredContent` — a summary that reports
   "0 data points" while the structured payload holds a full series is a bug, and was
   the most common one in this repo's history.
4. API requests use `fetchWithRetry` with exponential backoff for 429/5xx errors.
5. Dates are validated with strict calendar checking (no silent overflow) in UTC.
6. Tokens are never printed to stdout in full.

## License

MIT
