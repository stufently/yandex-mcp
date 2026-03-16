# yandex-wordstat-mcp

MCP server for Yandex Wordstat API. Research keywords, analyze search volume trends, and explore regional search distribution for Russian and CIS markets.

## Installation

```bash
npx yandex-wordstat-mcp
```

## Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "yandex-wordstat": {
      "command": "npx",
      "args": ["-y", "yandex-wordstat-mcp"],
      "env": {
        "YANDEX_WORDSTAT_TOKEN": "your-oauth-token"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YANDEX_WORDSTAT_TOKEN` | Yes | OAuth token for Wordstat API |
| `YANDEX_CLIENT_ID` | For auth flow | Yandex OAuth app client ID |
| `YANDEX_CLIENT_SECRET` | For auth flow | Yandex OAuth app client secret |

## Authentication

To obtain an OAuth token interactively:

```bash
npx yandex-wordstat-mcp auth
```

This opens a browser for Yandex OAuth authorization and returns a token. Set the token as `YANDEX_WORDSTAT_TOKEN`.

## Rate Limiting

The server enforces a client-side rate limit of 10 requests per second using a sliding window. Requests exceeding the limit are automatically queued. Additionally, 429 and 5xx responses trigger automatic retry with exponential backoff.

## Tool Reference

### get-regions-tree

Get the Yandex Wordstat regions hierarchy tree. Free (0 quota units).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `depth` | number | No | 3 | Maximum tree depth (1-5) |

Returns a tree of regions with `value` (region ID), `label` (name), and `children`.

### get-region-children

Get children of a specific region from the cached tree. Free (0 quota units). Does not make an API call -- works from the cached region tree.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `regionId` | number | Yes | -- | Region ID to get children for |
| `depth` | number | No | 2 | Maximum subtree depth (1-3) |

### top-requests

Find popular search queries containing a keyword. Costs 1 quota unit.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phrase` | string | Yes | -- | Keyword or phrase to search for |
| `regions` | number[] | No | -- | Region IDs to filter by |
| `devices` | enum[] | No | -- | Device types: `desktop`, `phone`, `tablet` |

Returns an array of `{ phrase, count }` sorted by search volume.

### dynamics

Analyze search volume trends over time for a keyword. Costs 2 quota units.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phrase` | string | Yes | -- | Keyword or phrase |
| `period` | enum | No | `monthly` | Aggregation: `daily`, `weekly`, `monthly` |
| `fromDate` | string | No | auto | Start date (YYYY-MM-DD) |
| `toDate` | string | No | auto | End date (YYYY-MM-DD) |
| `regions` | number[] | No | -- | Region IDs |
| `devices` | enum[] | No | -- | Device types: `desktop`, `phone`, `tablet` |

Default date ranges by period:
- `daily`: last 60 days
- `weekly`: last ~1 year (Monday to Sunday boundaries)
- `monthly`: last 12 months (1st to end of month boundaries)

Returns an array of `{ date, count }` data points.

### regions

Get regional distribution of search interest for a keyword. Costs 2 quota units.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phrase` | string | Yes | -- | Keyword or phrase |
| `regions` | number[] | No | -- | Region IDs to filter (client-side, includes descendants) |
| `devices` | enum[] | No | -- | Device types: `desktop`, `phone`, `tablet` |
| `limit` | number | No | 20 | Maximum results (1-50) |

Returns an array of `{ regionId, regionName, count, share, affinityIndex }` sorted by count. Region names are enriched from the cached region tree.

## Caching

The region tree is fetched once on the first call to `get-regions-tree`, `get-region-children`, or `regions`, and cached for the entire server session. A flat lookup map is built for O(1) region name resolution.

## License

MIT
