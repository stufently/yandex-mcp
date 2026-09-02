# Yandex MCP

A monorepo of MCP (Model Context Protocol) servers for Yandex APIs. Provides AI assistants with access to Yandex Search, Wordstat, Webmaster, Metrika, and Direct through a unified interface.

Built for Russian and CIS market analysis -- keyword research, search analytics, site monitoring, web traffic insights, and ad campaign management.

## Packages

| Package | Description | Tools |
|---------|-------------|-------|
| [yandex-search-mcp](packages/yandex-search-mcp) | Yandex Search API v2 (Cloud) | 1 |
| [yandex-wordstat-mcp](packages/yandex-wordstat-mcp) | Yandex Wordstat (Cloud Search API v2) -- keyword research | 5 |
| [yandex-webmaster-mcp](packages/yandex-webmaster-mcp) | Yandex Webmaster API v4 -- site analytics | 31 |
| [yandex-metrika-mcp](packages/yandex-metrika-mcp) | Yandex Metrika API -- web analytics | 12 |
| [yandex-direct-mcp](packages/yandex-direct-mcp) | Yandex Direct API v5 -- ad campaigns | 43 |

**92 tools total** across all packages (counted by `node scripts/smoke-tools.mjs`).

> **Package names.** These packages will be published under the **`@stufently/*` scope**
> (`@stufently/yandex-webmaster-mcp` and so on). The *unscoped* names — `yandex-search-mcp`,
> `yandex-wordstat-mcp`, `yandex-webmaster-mcp`, `yandex-metrika-mcp` — belong to a
> **different publisher** on the public registry (`altrr2`,
> [altrr2/yandex-tools-mcp](https://github.com/altrr2/yandex-tools-mcp), first published
> 2025-12-20, three months before this repo existed). Never `npx` an unscoped name with your
> Yandex tokens in the environment: that hands your credentials to unrelated code. Nothing has
> been published to the scope yet, so for now run the servers from source, as shown below.

## Install

**Prerequisites for both options:** Node.js >= 22 and [Bun](https://bun.sh/) on your `PATH`.
Bun is not optional — the repo carries a `bun.lock`, so Claude Code installs the plugin's
dependencies with Bun and does not fall back to npm.

### Option A — Claude Code plugin (recommended)

This repo ships as a Claude Code plugin, so you do not have to hand-write five MCP entries.
Add the repo as a marketplace and install:

```
/plugin marketplace add stufently/yandex-mcp
/plugin install yandex-mcp@stufently
```

Or without the interactive picker:

```bash
claude plugin marketplace add stufently/yandex-mcp
claude plugin install yandex-mcp@stufently --scope user
```

**What the plugin gives you over a hand-written MCP config:**

| | Plugin | Manual MCP config |
|---|---|---|
| Setup | two commands | edit JSON, restart client |
| All five servers | registered at once | five entries, one per server |
| Paths | resolved via `${CLAUDE_PLUGIN_ROOT}` | you hardcode absolute paths |
| Bundled skills | `yandex-keyword-research`, `yandex-competitive-analysis` installed too | not included — skills are Claude Code only |
| Updates | `/plugin update yandex-mcp@stufently` | `git pull` and re-check your paths |

The plugin installs the servers but **not the credentials** — Claude Code substitutes only
`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PROJECT_DIR}`. Supply the Yandex
tokens yourself, either by exporting them in your shell or by putting them in
`~/.claude/settings.json`:

```json
{
  "env": {
    "YANDEX_SEARCH_API_KEY": "...",
    "YANDEX_FOLDER_ID": "...",
    "WORDSTAT_API_KEY": "...",
    "WORDSTAT_FOLDER_ID": "...",
    "YANDEX_WEBMASTER_TOKEN": "...",
    "YANDEX_METRIKA_TOKEN": "...",
    "YANDEX_DIRECT_TOKEN": "..."
  }
}
```

Servers whose variables are missing simply fail on first use; the rest keep working, so you can
install the plugin and set up one API at a time.

### Option B — from source

```bash
git clone https://github.com/stufently/yandex-mcp.git
cd yandex-mcp
bun install
cp .env.example .env   # then fill it in
```

For Webmaster and Metrika you can mint an OAuth token with the built-in flow (needs
`YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` from your own Yandex OAuth app):

```bash
node packages/yandex-webmaster-mcp/src/index.mjs auth
node packages/yandex-metrika-mcp/src/index.mjs auth
```

Search and Wordstat do not use OAuth: both talk to Yandex Cloud and need a service-account API
key plus a folder ID.

The Metrika helper requests `metrika:read metrika:write`, because `create-counter` and
`delete-counter` are refused with HTTP 403 by a read-only token. To keep a token that cannot
modify anything, narrow the scope explicitly:

```bash
YANDEX_METRIKA_SCOPE="metrika:read" node packages/yandex-metrika-mcp/src/index.mjs auth
```

The two write tools then fail with a 403 that names the missing scope, instead of a bare
permission error.

A write-capable token does not mean an unguarded delete: `delete-counter` refuses unless the
call passes `confirm: true`, and the refusal happens before any request reaches Yandex. See
[Deleting a counter](packages/yandex-metrika-mcp/README.md#deleting-a-counter).

The same rule holds across the monorepo: an operation that cannot be undone through the API it
is called with asks for `confirm: true` first — `delete-counter` in Metrika,
[`delete-host`](packages/yandex-webmaster-mcp/README.md#deleting-a-host) in Webmaster, and the
[fourteen delete/update/bid tools](packages/yandex-direct-mcp/README.md#irreversible-tools-need-confirm-true)
in Direct. Additive and reversible writes (`create-counter`, `add-host`, `add_*`, archive and
suspend) run without one, so the confirmation stays a signal rather than a reflex. Search and
Wordstat are read-only and have nothing to guard.

> Nothing is published to npm yet, so there is no `npx` form. Do not `npx` the **unscoped**
> names — they belong to a different publisher (see the note above).

## Client Configuration

All five servers speak stdio and take no arguments beyond the script path, so the same block
works in any MCP client. Replace `/path/to/yandex-mcp` with your checkout and drop the servers
you do not need.

### Claude Code

Easiest is the plugin (Option A). To wire it up by hand instead, per server:

```bash
claude mcp add yandex-wordstat --scope user \
  --env WORDSTAT_API_KEY=... --env WORDSTAT_FOLDER_ID=... \
  -- node /path/to/yandex-mcp/packages/yandex-wordstat-mcp/src/index.mjs
```

Inside a clone, the checked-in `.mcp.json` already registers all five from `.env`:

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

Those paths are relative, so this one only works with the repo root as the working directory.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/.config/Claude/claude_desktop_config.json` on Linux:

```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-search-mcp/src/index.mjs"],
      "env": {
        "YANDEX_SEARCH_API_KEY": "your-cloud-api-key",
        "YANDEX_FOLDER_ID": "your-folder-id"
      }
    },
    "yandex-wordstat": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-wordstat-mcp/src/index.mjs"],
      "env": {
        "WORDSTAT_API_KEY": "your-cloud-api-key",
        "WORDSTAT_FOLDER_ID": "your-folder-id"
      }
    },
    "yandex-webmaster": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-webmaster-mcp/src/index.mjs"],
      "env": { "YANDEX_WEBMASTER_TOKEN": "your-oauth-token" }
    },
    "yandex-metrika": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-metrika-mcp/src/index.mjs"],
      "env": { "YANDEX_METRIKA_TOKEN": "your-oauth-token" }
    },
    "yandex-direct": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-direct-mcp/src/index.mjs"],
      "env": {
        "YANDEX_DIRECT_TOKEN": "your-oauth-token",
        "YANDEX_DIRECT_SANDBOX": "true"
      }
    }
  }
}
```

### Cursor

Same shape, in `.cursor/mcp.json` for one project or `~/.cursor/mcp.json` globally — copy the
block above verbatim.

### Windsurf, Cline, and other stdio clients

Any client that launches an MCP server as a subprocess takes the same `command` / `args` /
`env` triple; only the file it lives in differs.

## Environment Variables

| Variable | Required by | Description |
|----------|-------------|-------------|
| `YANDEX_SEARCH_API_KEY` | yandex-search-mcp | API key from [Yandex Cloud](https://console.yandex.cloud/) |
| `YANDEX_FOLDER_ID` | yandex-search-mcp | Folder ID from Yandex Cloud |
| `WORDSTAT_API_KEY` | yandex-wordstat-mcp | Yandex Cloud API key (service account, role `search-api.webSearch.user`) |
| `WORDSTAT_FOLDER_ID` | yandex-wordstat-mcp | Yandex Cloud folder ID for Search API v2 |
| `YANDEX_WEBMASTER_TOKEN` | yandex-webmaster-mcp | OAuth token for Webmaster |
| `YANDEX_METRIKA_TOKEN` | yandex-metrika-mcp | OAuth token for Metrika (`metrika:read` to read, `metrika:write` also needed for counter tools) |
| `YANDEX_METRIKA_SCOPE` | OAuth flow (optional) | Override requested scopes; default `metrika:read metrika:write` |
| `YANDEX_DIRECT_TOKEN` | yandex-direct-mcp | OAuth token for Direct API v5 |
| `YANDEX_DIRECT_CLIENT_LOGIN` | yandex-direct-mcp (agencies) | Client login to act on behalf of |
| `YANDEX_DIRECT_SANDBOX` | yandex-direct-mcp (optional) | `true` to hit the Direct sandbox |
| `YANDEX_CLIENT_ID` | OAuth flow (optional) | Yandex OAuth app client ID |
| `YANDEX_CLIENT_SECRET` | OAuth flow (optional) | Yandex OAuth app client secret |

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

You only need the variables for the servers you actually enable — each server reads its own
and ignores the rest.

## Common Prompts

Once a server is connected, these are the kinds of requests it can answer. Each example maps
onto real tools listed in the per-package READMEs.

### yandex-search (1 tool)

- "Search Yandex for «купить кондиционер» and show me the top 10 results with their domains."
- "Who ranks on Yandex for «доставка пиццы» in region 2 (Saint Petersburg)? Give positions and titles."
- "Search yandex.ru for «отзывы о клинике» with strict family mode and pull 20 results."
- "Get page 2 of Yandex results for «ремонт ноутбуков Москва»."

### yandex-wordstat (5 tools)

- "How many people search «купить ноутбук» on Yandex per month, and what related queries come up?"
- "Show the monthly trend for «горящие туры» over the last two years — is demand growing?"
- "Which Russian regions search «кондиционер» the most? Show volume and affinity index for the top 20."
- "Give me the Yandex region tree down to depth 2 so I can pick region IDs for filtering."
- "Compare desktop vs phone demand for «доставка еды»."

### yandex-webmaster (32 tools)

- "List my verified sites in Yandex Webmaster with their SQI."
- "Add https://example.com/sitemap.xml to Webmaster for example.com."
- "List the pages excluded from search on example.com with the reason for each one."
- "Why did pages drop out of search on example.com? Group the samples by exclusion reason."
- "What are my top 50 queries by clicks for example.com, and how did positions move?"
- "Show indexing history for example.com and flag any sudden drop in pages in search."
- "What site problems does Yandex report for example.com right now?"
- "Send https://example.com/new-page for recrawl and tell me my remaining daily quota."
- "Show broken internal links on example.com."

### yandex-metrika (12 tools)

- "Traffic summary for counter 12345678 last month — visits, users, bounce rate, average duration."
- "Where does my traffic come from? Break it down by source for counter 12345678."
- "Top 20 landing pages by pageviews for counter 12345678 last week."
- "Which countries and cities do my visitors come from?"
- "Custom report: `ym:s:visits` by `ym:s:trafficSource` and `ym:s:deviceCategory` for the last 7 days."

### yandex-direct (43 tools)

- "List my active Yandex Direct campaigns with their types and states."
- "Show the keywords in campaign 123 together with their current search bids."
- "Build a last-30-days campaign performance report with impressions, clicks, and cost."
- "Pause campaign 123, then confirm its new state."
- "Pull the GeoRegions dictionary so I can pick targeting IDs."

> **Direct writes are live.** Every write hits the production account — there is no dry-run.
> The fourteen that cannot be undone (`delete_*`, `update_*` and the three bid `set_*` tools)
> refuse unless the call passes `confirm: true`; `add_*`, `archive_*`/`unarchive_*`,
> `suspend_*`/`resume_*` and `moderate_ads` have an inverse tool and run straight away. Bids are
> expressed in micros (×10⁶). Set `YANDEX_DIRECT_SANDBOX=true` while experimenting. See
> [Irreversible tools](packages/yandex-direct-mcp/README.md#irreversible-tools-need-confirm-true).

## Skills

These are Claude Code skills, installed automatically with the plugin (Option A). They are not
available to other MCP clients, which get the raw tools only.

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
  yandex-webmaster-mcp/    # 32 tools - Site analytics  (SKILL.md — agent playbook;
                           #                            src/series.mjs — time series shapes;
                           #                            src/exclusions.mjs — exclusion reasons)
  yandex-metrika-mcp/      # 12 tools - Web analytics
  yandex-direct-mcp/       # 43 tools - Ad campaigns
scripts/smoke-tools.mjs    # Starts every server and checks tools/list
.claude/skills/            # Claude Code skills (shipped with the plugin)
.mcp.json                  # Local dev config
plugin.mcp.json            # Distribution config — the 5 servers the plugin registers
.claude-plugin/
  plugin.json              # Plugin manifest
  marketplace.json         # Marketplace catalog, so the repo can be added directly
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
