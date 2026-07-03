# yandex-wordstat-mcp

MCP server for Yandex Wordstat via **Yandex Cloud Search API v2**. Research keywords, analyze search volume trends, and explore regional search distribution for Russian and CIS markets.

> **v2.0:** the legacy `api.wordstat.yandex.net` API was shut down by Yandex in 2026. The server now talks to `searchapi.api.cloud.yandex.net/v2/wordstat/*` and authenticates with a Yandex Cloud API key instead of an OAuth token. Tool names and parameters are unchanged.

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
        "WORDSTAT_API_KEY": "AQVN...",
        "WORDSTAT_FOLDER_ID": "b1g..."
      }
    }
  }
}
```

Alternatively, put the credentials into `~/.config/yandex-cloud/wordstat.env` (used as a fallback when the env vars are not set):

```
WORDSTAT_API_KEY=AQVN...
WORDSTAT_FOLDER_ID=b1g...
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WORDSTAT_API_KEY` | Yes | Yandex Cloud API key (secret, `AQVN...`) of a service account |
| `WORDSTAT_FOLDER_ID` | Yes | Yandex Cloud folder ID (`b1g...`) used for billing and access checks |

## Authentication (how to get the key)

1. Sign in to the [Yandex Cloud console](https://console.yandex.cloud/) and pick (or create) a folder — its ID is visible in the URL: `console.yandex.cloud/folders/<folderId>/...`. A billing account must be linked to the cloud.
2. Create a **service account** in that folder with the **`search-api.webSearch.user`** role.
3. Open the service account → **Create new key → API key**, scope **`yc.search-api.execute`**.
4. Copy the secret (shown once) into `WORDSTAT_API_KEY`; the key identifier (`ajel...`) is only needed to rotate or revoke the key later.

## Rate Limiting

The server enforces a client-side rate limit of 10 requests per second using a sliding window. Requests exceeding the limit are automatically queued. Additionally, 429 and 5xx responses trigger automatic retry with exponential backoff.

## Tool Reference

### get-regions-tree

Get the Yandex Wordstat regions hierarchy tree.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `depth` | number | No | 3 | Maximum tree depth (1-5) |

Returns a tree of regions with `value` (region ID), `label` (name), and `children`.

### get-region-children

Get children of a specific region from the cached tree. Does not make an API call -- works from the cached region tree.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `regionId` | number | Yes | -- | Region ID to get children for |
| `depth` | number | No | 2 | Maximum subtree depth (1-3) |

### top-requests

Find popular search queries containing a keyword (last 30 days), plus associated queries.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phrase` | string | Yes | -- | Keyword or phrase to search for (max 400 chars) |
| `regions` | number[] | No | -- | Region IDs to filter by |
| `devices` | enum[] | No | -- | Device types: `desktop`, `phone`, `tablet` |
| `limit` | number | No | 100 | Max phrases in response (1-2000) |

Returns `{ topRequests: [{ phrase, count }], associations: [{ phrase, count }], totalCount }` sorted by search volume.

### dynamics

Analyze search volume trends over time for a keyword.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phrase` | string | Yes | -- | Keyword or phrase (max 400 chars) |
| `period` | enum | No | `monthly` | Aggregation: `daily`, `weekly`, `monthly` |
| `fromDate` | string | No | auto | Start date (YYYY-MM-DD) |
| `toDate` | string | No | auto | End date (YYYY-MM-DD) |
| `regions` | number[] | No | -- | Region IDs |
| `devices` | enum[] | No | -- | Device types: `desktop`, `phone`, `tablet` |

Default date ranges by period:
- `daily`: last 60 days
- `weekly`: last ~1 year (Monday to Sunday boundaries)
- `monthly`: last 12 months (1st to end of month boundaries)

Returns an array of `{ date, count, share }` data points.

### regions

Get regional distribution of search interest for a keyword.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phrase` | string | Yes | -- | Keyword or phrase (max 400 chars) |
| `regions` | number[] | No | -- | Region IDs to filter (client-side, includes descendants) |
| `devices` | enum[] | No | -- | Device types: `desktop`, `phone`, `tablet` |
| `limit` | number | No | 20 | Maximum results (1-50) |

Returns an array of `{ regionId, regionName, count, share, affinityIndex }` sorted by count. Region names are enriched from the cached region tree.

## Caching

The region tree is fetched once on the first call to `get-regions-tree`, `get-region-children`, or `regions`, and cached for the entire server session. A flat lookup map is built for O(1) region name resolution.

## License

MIT
