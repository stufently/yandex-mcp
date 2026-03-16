# yandex-search-mcp

MCP server for Yandex Search API v2 (Cloud). Search the web through Yandex and get structured results with titles, snippets, URLs, and metadata.

## Installation

```bash
npx yandex-search-mcp
```

## Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "npx",
      "args": ["-y", "yandex-search-mcp"],
      "env": {
        "YANDEX_SEARCH_API_KEY": "your-api-key",
        "YANDEX_FOLDER_ID": "your-folder-id"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YANDEX_SEARCH_API_KEY` | Yes | API key from [Yandex Cloud Console](https://console.yandex.cloud/) |
| `YANDEX_FOLDER_ID` | Yes | Folder ID from Yandex Cloud |

No OAuth flow is needed. Get both values from the Yandex Cloud Console.

## Tool Reference

### search

Search the web using Yandex Search API. Returns ranked results with titles, snippets, and URLs.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | -- | Search query text |
| `maxResults` | number | No | 10 | Maximum results to return (1-100) |
| `region` | number | No | -- | Yandex region ID |
| `page` | number | No | 0 | Page number (0-based) |
| `familyMode` | enum | No | `FAMILY_MODE_MODERATE` | Safe search: `FAMILY_MODE_NONE`, `FAMILY_MODE_MODERATE`, `FAMILY_MODE_STRICT` |

**Response fields:**

Each result contains:

| Field | Type | Description |
|-------|------|-------------|
| `position` | number | Ranking position (1-based) |
| `url` | string | Result URL |
| `domain` | string | Hostname extracted from URL |
| `title` | string | Page title |
| `headline` | string | Meta description |
| `passages` | string[] | Relevant text passages |
| `snippet` | string | Combined headline and passages |
| `size` | number | Document size in bytes |
| `lang` | string | Document language |
| `cachedUrl` | string | Yandex cached copy URL |

**Language detection:**

The search type and localization are automatically selected based on the query. Queries containing Cyrillic characters use the Russian search index; Latin-only queries use the international index.

## API Details

- Endpoint: `POST https://searchapi.api.cloud.yandex.net/v2/web/search`
- Auth: `Api-Key` header
- Response: JSON with base64-encoded XML in `rawData` field
- Automatic retry with exponential backoff on 429/5xx errors

## License

MIT
