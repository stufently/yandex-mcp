# yandex-webmaster-mcp

MCP server for Yandex Webmaster API v4. Monitor site health, indexing status, search queries, backlinks, sitemaps, and more.

## Installation

This package is published as **`@stufently/yandex-webmaster-mcp`**; the unscoped name `yandex-webmaster-mcp`
belongs to an unrelated publisher (see the note in the [root README](../../README.md)).
Nothing is on the scope yet, so run it from source:

```bash
git clone https://github.com/stufently/yandex-mcp.git
cd yandex-mcp && bun install
node packages/yandex-webmaster-mcp/src/index.mjs
```

## Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "yandex-webmaster": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-webmaster-mcp/src/index.mjs"],
      "env": {
        "YANDEX_WEBMASTER_TOKEN": "your-oauth-token"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YANDEX_WEBMASTER_TOKEN` | Yes | OAuth token for Webmaster API |
| `YANDEX_CLIENT_ID` | For auth flow | Yandex OAuth app client ID |
| `YANDEX_CLIENT_SECRET` | For auth flow | Yandex OAuth app client secret |

## Authentication

To obtain an OAuth token interactively:

```bash
node packages/yandex-webmaster-mcp/src/index.mjs auth
```

This opens a browser for Yandex OAuth authorization and returns a token. Set the token as `YANDEX_WEBMASTER_TOKEN`.

Note: The Webmaster API uses `Authorization: OAuth {token}` (not Bearer).

## Tool Reference (30 tools)

### Core (3)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-user` | Get current Webmaster user info and user_id | -- |
| `list-hosts` | List all verified hosts (sites) | -- |
| `get-host` | Get details for a specific host | `host_id` |

### Statistics (2)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-summary` | Get site summary: SQI, page counts, problems | `host_id` |
| `get-sqi-history` | Get SQI (Site Quality Index) history | `host_id`, `date_from?`, `date_to?` |

### Diagnostics (1)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-diagnostics` | Get site diagnostics and problems | `host_id` |

### Search Queries (2)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-popular-queries` | Get popular search queries for a site | `host_id`, `order_by` (TOTAL_SHOWS/TOTAL_CLICKS), `device_type?`, `date_from?`, `date_to?`, `limit?` (1-500, default: 100), `offset?` |
| `get-query-history` | Get search query totals history | `host_id`, `device_type?`, `date_from?`, `date_to?` |

### Indexing (4)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-indexing-history` | Get indexing history over time | `host_id`, `date_from?`, `date_to?` |
| `get-indexing-samples` | Get sample indexed URLs | `host_id`, `limit?` (1-100), `offset?` |
| `get-insearch-history` | Get in-search (appearing in results) history | `host_id`, `date_from?`, `date_to?` |
| `get-insearch-samples` | Get sample URLs appearing in search | `host_id`, `limit?` (1-100), `offset?` |

### Search Events (2)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-search-events-history` | Get search URL events history | `host_id`, `date_from?`, `date_to?` |
| `get-search-events-samples` | Get sample URLs for search events | `host_id`, `event_type?` (APPEARED_IN_SEARCH/REMOVED_FROM_SEARCH — client-side filter, the API has none), `limit?` (1-100, default: 10), `offset?` |

### Links (4)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-external-links` | Get external links pointing to the site | `host_id`, `limit?` (1-100), `offset?` |
| `get-external-links-history` | Get external links count history | `host_id`, `date_from?`, `date_to?` |
| `get-broken-internal-links` | Get broken internal links | `host_id`, `limit?` (1-100), `offset?` |
| `get-broken-internal-links-history` | Get broken internal links count history | `host_id`, `date_from?`, `date_to?` |

### Sitemaps (3)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-sitemaps` | List all sitemaps for a host | `host_id`, `limit?` (1-100) |
| `get-sitemap` | Get details for a specific sitemap | `host_id`, `sitemap_id` |
| `get-user-sitemaps` | List user-added sitemaps | `host_id`, `limit?` (1-100) |

### Important URLs (2)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-important-urls` | Get important URLs for a site | `host_id`, `limit?` (1-100), `offset?` |
| `get-important-url-history` | Get history for a specific important URL | `host_id`, `url`, `date_from?`, `date_to?` |

### Recrawl (4)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-recrawl-quota` | Get recrawl quota (daily limit and remainder) | `host_id` |
| `add-recrawl-url` | **Write.** Enqueue a URL for re-crawl; consumes daily quota | `host_id`, `url` |
| `get-recrawl-queue` | List submitted recrawl tasks and their state | `host_id`, `limit?` (default: 10), `offset?` |
| `get-recrawl-task` | Get the state of one recrawl task | `host_id`, `task_id` |

### Host Management (3)

These change your Webmaster account, not just read from it. There is no confirmation step.

| Tool | Description | Parameters |
|------|-------------|------------|
| `add-host` | **Write.** Add a site to Webmaster (needs verification afterwards) | `host_url` (with protocol) |
| `verify-host` | Get verification state and applicable verification methods | `host_id` |
| `delete-host` | **Write.** Remove a site from Webmaster | `host_id` |

## Common Parameters

- `host_id` -- Host identifier, URL-encoded (e.g., `https:example.com:443`). Get it from `list-hosts`.
- `date_from`, `date_to` -- Dates in YYYY-MM-DD format. Strictly validated (no silent date overflow).
- `limit`, `offset` -- Pagination controls.
- `device_type` -- One of: `ALL`, `DESKTOP`, `MOBILE`, `TABLET`, `MOBILE_AND_TABLET`.

## Caching

The `user_id` is fetched once on the first API call and cached for the session. It is automatically invalidated on 401/403 errors.

## License

MIT
