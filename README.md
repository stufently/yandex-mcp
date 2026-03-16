# Yandex MCP

A monorepo of MCP (Model Context Protocol) servers for Yandex APIs. Provides AI assistants with access to Yandex Search, Wordstat, Webmaster, and Metrika through a unified interface.

Built for Russian and CIS market analysis -- keyword research, search analytics, site monitoring, and web traffic insights.

## Packages

| Package | Description | Tools | npm |
|---------|-------------|-------|-----|
| [yandex-search-mcp](packages/yandex-search-mcp) | Yandex Search API v2 (Cloud) | 1 | `npx yandex-search-mcp` |
| [yandex-wordstat-mcp](packages/yandex-wordstat-mcp) | Yandex Wordstat API -- keyword research | 5 | `npx yandex-wordstat-mcp` |
| [yandex-webmaster-mcp](packages/yandex-webmaster-mcp) | Yandex Webmaster API v4 -- site analytics | 24 | `npx yandex-webmaster-mcp` |
| [yandex-metrika-mcp](packages/yandex-metrika-mcp) | Yandex Metrika API -- web analytics | 10 | `npx yandex-metrika-mcp` |

**40 tools total** across all packages.

## Quick Start

1. Install the package you need:

```bash
npx yandex-search-mcp
npx yandex-wordstat-mcp
npx yandex-webmaster-mcp
npx yandex-metrika-mcp
```

2. Set environment variables (see below).

3. For packages that require OAuth tokens (Wordstat, Webmaster, Metrika), run the auth flow:

```bash
npx yandex-wordstat-mcp auth
npx yandex-webmaster-mcp auth
npx yandex-metrika-mcp auth
```

## Configuration

### For MCP clients (Claude Desktop, etc.)

Add to your MCP client configuration. Example using `plugin.mcp.json`:

```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "npx",
      "args": ["-y", "yandex-search-mcp"],
      "env": {
        "YANDEX_SEARCH_API_KEY": "${YANDEX_SEARCH_API_KEY}",
        "YANDEX_FOLDER_ID": "${YANDEX_FOLDER_ID}"
      }
    },
    "yandex-wordstat": {
      "command": "npx",
      "args": ["-y", "yandex-wordstat-mcp"],
      "env": { "YANDEX_WORDSTAT_TOKEN": "${YANDEX_WORDSTAT_TOKEN}" }
    },
    "yandex-webmaster": {
      "command": "npx",
      "args": ["-y", "yandex-webmaster-mcp"],
      "env": { "YANDEX_WEBMASTER_TOKEN": "${YANDEX_WEBMASTER_TOKEN}" }
    },
    "yandex-metrika": {
      "command": "npx",
      "args": ["-y", "yandex-metrika-mcp"],
      "env": { "YANDEX_METRIKA_TOKEN": "${YANDEX_METRIKA_TOKEN}" }
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
    }
  }
}
```

## Environment Variables

| Variable | Required by | Description |
|----------|-------------|-------------|
| `YANDEX_SEARCH_API_KEY` | yandex-search-mcp | API key from [Yandex Cloud](https://console.yandex.cloud/) |
| `YANDEX_FOLDER_ID` | yandex-search-mcp | Folder ID from Yandex Cloud |
| `YANDEX_WORDSTAT_TOKEN` | yandex-wordstat-mcp | OAuth token for Wordstat |
| `YANDEX_WEBMASTER_TOKEN` | yandex-webmaster-mcp | OAuth token for Webmaster |
| `YANDEX_METRIKA_TOKEN` | yandex-metrika-mcp | OAuth token for Metrika (scope: `metrika:read`) |
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
```

### Tech Stack

- Pure ES Modules (`.mjs`, no TypeScript, no build step)
- `@modelcontextprotocol/sdk` (^1.27.1)
- `zod` (^4.3.6) for input validation
- [Biome](https://biomejs.dev/) for linting and formatting

### Project Structure

```
packages/
  yandex-search-mcp/      # 1 tool  - Yandex Search
  yandex-wordstat-mcp/     # 5 tools - Keyword research
  yandex-webmaster-mcp/    # 24 tools - Site analytics
  yandex-metrika-mcp/      # 10 tools - Web analytics
.claude/skills/            # Claude Code skills
.mcp.json                  # Local dev config
plugin.mcp.json            # Distribution config
.claude-plugin/            # Plugin manifest
```

## Contributing

Contributions are welcome. Please ensure:

1. Code passes `bun run lint` with no errors.
2. All tools return both `content` (human-readable) and `structuredContent` (raw API data).
3. API requests use `fetchWithRetry` with exponential backoff for 429/5xx errors.
4. Dates are validated with strict calendar checking (no silent overflow).
5. Tokens are never printed to stdout in full.

## License

MIT
