# yandex-direct-mcp

MCP server for [Yandex Direct API v5](https://yandex.ru/dev/direct/) — campaigns, ad groups,
ads, keywords, bids, bid modifiers, sitelinks, vCards, and reports. 43 tools.

> **Write access, no dry-run.** Unlike the other servers in this monorepo, this one changes
> live advertising data: it can create, update, delete and archive campaigns and ads, and set
> bids (in micro-units — a factor-of-1,000,000 mistake is a real risk). There is no
> confirmation step and no dry-run mode. Point it at the sandbox
> (`YANDEX_DIRECT_SANDBOX=true`) until you trust the workflow.

## Installation

This package is published as **`@stufently/yandex-direct-mcp`**; unscoped `yandex-*-mcp`
names on the public registry belong to an unrelated publisher (see the note in the
[root README](../../README.md)). Nothing is on the scope yet, so run it from source:

```bash
git clone https://github.com/stufently/yandex-mcp.git
cd yandex-mcp && bun install
node packages/yandex-direct-mcp/src/index.mjs
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `YANDEX_DIRECT_TOKEN` | yes | OAuth token for Direct API v5 |
| `YANDEX_DIRECT_CLIENT_LOGIN` | agencies only | Client login to act on behalf of |
| `YANDEX_DIRECT_SANDBOX` | no | `true` routes calls to the Direct sandbox |

```json
{
  "mcpServers": {
    "yandex-direct": {
      "command": "node",
      "args": ["/path/to/yandex-mcp/packages/yandex-direct-mcp/src/index.mjs"],
      "env": { "YANDEX_DIRECT_TOKEN": "your-token" }
    }
  }
}
```

## Tools

| Area | Tools |
|------|-------|
| Campaigns | `get_campaigns`, `add_campaigns`, `update_campaigns`, `delete_campaigns`, `archive_campaigns`, `unarchive_campaigns`, `suspend_campaigns`, `resume_campaigns` |
| Ad groups | `get_adgroups`, `add_adgroups`, `update_adgroups`, `delete_adgroups`, `archive_adgroups`, `unarchive_adgroups` |
| Ads | `get_ads`, `add_ads`, `update_ads`, `delete_ads`, `archive_ads`, `unarchive_ads`, `moderate_ads` |
| Keywords | `get_keywords`, `add_keywords`, `update_keywords`, `delete_keywords`, `suspend_keywords`, `resume_keywords` |
| Bids | `get_keyword_bids`, `set_keyword_bids`, `set_auto_keyword_bids`, `get_bid_modifiers`, `add_bid_modifiers`, `set_bid_modifiers`, `delete_bid_modifiers` |
| Extensions | `get_sitelinks`, `add_sitelinks`, `delete_sitelinks`, `get_vcards`, `add_vcards`, `delete_vcards` |
| Other | `create_report`, `get_dictionaries`, `get_clients` |

## Known limitations

- The API path is hard-coded to `/json/v5`, so the unified performance campaigns endpoint
  (`v501`) is unreachable.
- The `Units` response header (points consumed / remaining) is not surfaced, so a client
  cannot see how much of its quota a call cost.

## License

MIT
