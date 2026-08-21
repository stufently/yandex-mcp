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

## Irreversible tools need `confirm: true`

Fourteen tools cannot be undone through this API, and this is the one server where a mistaken
call spends real money. They refuse unless the call carries `confirm: true`:

| Family | Tools | Why it cannot be undone |
|--------|-------|-------------------------|
| Deletes | `delete_campaigns`, `delete_adgroups`, `delete_ads`, `delete_keywords`, `delete_bid_modifiers`, `delete_sitelinks`, `delete_vcards` | The entity and the statistics attached to it are gone; `add_*` creates a new entity with a new ID, not the old one back |
| Updates | `update_campaigns`, `update_adgroups`, `update_ads`, `update_keywords` | Fields are overwritten in place and Direct exposes no revision history, so the previous ad text, budget or strategy cannot be read back |
| Bids | `set_keyword_bids`, `set_auto_keyword_bids`, `set_bid_modifiers` | Same overwrite, with a price tag: these are the numbers that decide what the account pays per click |

```json
{ "ids": [12345], "confirm": true }
```

Called without it, the tool returns an error result and sends **nothing** to the Direct API — no
entity touched, no bid moved, no API units spent:

```
Refused: `delete_campaigns` requires explicit confirmation.

Target — IDs: 12345. Deleting campaigns is irreversible: they and their accumulated statistics
are gone for good, and Yandex Direct offers no way to restore them.

Nothing was sent to the Yandex Direct API — no campaign, ad, keyword or bid was touched, and no
API units were spent.

To go ahead, call `delete_campaigns` again with the same ids and `confirm: true`.
To see the current state first, call `get_campaigns`.
```

`confirm` is optional in the JSON schema on purpose: a missing confirmation has to come back as
that explanation, not as a schema validation error a model cannot act on. Only a literal `true`
counts — `"true"`, `1` and `"yes"` are refused, because a guess at the protocol is not a decision
to spend money. All fourteen carry `destructiveHint: true` in their MCP annotations, so clients
that surface tool risk can show it before the call.

**`add_*`, `archive_*`/`unarchive_*`, `suspend_*`/`resume_*` and `moderate_ads` are deliberately
left unguarded.** Each has an inverse in this same server (or, for `moderate_ads`, leaves the
entity itself untouched), so they are changes rather than losses. Guarding every write would
train callers to pass `confirm: true` by reflex — which is exactly what would defeat it on the
fourteen calls that matter.

Bids are expressed in micros (×10⁶). Set `YANDEX_DIRECT_SANDBOX=true` while experimenting.

## Known limitations

- The API path is hard-coded to `/json/v5`, so the unified performance campaigns endpoint
  (`v501`) is unreachable.
- The `Units` response header (points consumed / remaining) is not surfaced, so a client
  cannot see how much of its quota a call cost.

## License

MIT
