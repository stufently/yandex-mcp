# yandex-metrika-mcp

MCP server for Yandex Metrika API. Access web analytics data -- traffic summaries, audience demographics, traffic sources, popular pages, search phrases, and custom reports.

## Installation

```bash
npx yandex-metrika-mcp
```

## Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "yandex-metrika": {
      "command": "npx",
      "args": ["-y", "yandex-metrika-mcp"],
      "env": {
        "YANDEX_METRIKA_TOKEN": "your-oauth-token"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YANDEX_METRIKA_TOKEN` | Yes | OAuth token with `metrika:read` scope |
| `YANDEX_CLIENT_ID` | For auth flow | Yandex OAuth app client ID |
| `YANDEX_CLIENT_SECRET` | For auth flow | Yandex OAuth app client secret |

## Authentication

To obtain an OAuth token interactively:

```bash
npx yandex-metrika-mcp auth
```

This opens a browser for Yandex OAuth authorization (scope: `metrika:read`) and returns a token. Set the token as `YANDEX_METRIKA_TOKEN`.

Note: The Metrika API uses `Authorization: OAuth {token}` (not Bearer).

## Tool Reference (10 tools)

### Management (3)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-counters` | List all Metrika counters (sites) | -- |
| `get-counter` | Get details for a specific counter | `counter_id` |
| `get-goals` | Get goals for a counter | `counter_id` |

### Reporting (6)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-traffic-summary` | Visits, users, pageviews, bounce rate, avg duration | `counter_id`, `date_from?`, `date_to?` |
| `get-traffic-sources` | Traffic breakdown by source | `counter_id`, `date_from?`, `date_to?`, `limit?` (default: 10) |
| `get-geography` | Traffic breakdown by country and city | `counter_id`, `date_from?`, `date_to?`, `limit?` (default: 10) |
| `get-devices` | Traffic breakdown by device, browser, or OS | `counter_id`, `group_by?` (device/browser/os, default: device), `date_from?`, `date_to?`, `limit?` (default: 10) |
| `get-popular-pages` | Most visited pages | `counter_id`, `date_from?`, `date_to?`, `limit?` (default: 10) |
| `get-search-phrases` | Top search phrases driving traffic | `counter_id`, `date_from?`, `date_to?`, `limit?` (default: 20) |

### Custom (1)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-report` | Run a custom report with arbitrary metrics and dimensions | `counter_id`, `metrics`, `dimensions?`, `date_from?`, `date_to?`, `filters?`, `sort?`, `limit?` (default: 10) |

## get-report Parameters

The `get-report` tool provides full access to the Metrika Stat API:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `counter_id` | number | Yes | Counter ID |
| `metrics` | string | Yes | Comma-separated metrics (e.g., `ym:s:visits,ym:s:users`) |
| `dimensions` | string | No | Comma-separated dimensions (e.g., `ym:s:trafficSource`) |
| `date_from` | string | No | Start date YYYY-MM-DD (default: 30 days ago) |
| `date_to` | string | No | End date YYYY-MM-DD (default: today) |
| `filters` | string | No | Filter expression (e.g., `ym:s:trafficSource=='organic'`) |
| `sort` | string | No | Sort field, prefix with `-` for descending |
| `limit` | number | No | Max results (default: 10) |

## Default Date Range

When `date_from` and `date_to` are not specified, all reporting tools default to the last 30 days.

## Data Sampling

The Metrika Stat API may return sampled data for large datasets. When sampling is applied, the response includes a note indicating that figures are approximate.

## License

MIT
