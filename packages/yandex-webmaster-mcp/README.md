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

## Agent playbook

`SKILL.md` next to this file is the task-level guide for agents: the new-site flow, the
regular-audit order, the recrawl rules, how the three different time-series shapes are read,
and — importantly — what API v4 does **not** have (IndexNow, robots.txt, site region, favicon,
mobile status, Metrika binding), so nothing gets invented.

## Tool Reference (32 tools)

### Core (3)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-user` | Get current Webmaster user info and user_id | -- |
| `list-hosts` | List all hosts (sites) **with their `host_id`** — the identifier every other tool needs | -- |
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

### Search Events (3)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-search-events-history` | Get search URL events history | `host_id`, `date_from?`, `date_to?` |
| `get-search-events-samples` | Get sample URLs for search events, **with per-URL exclusion reasons** (`excluded_url_status`): an `exclusion_reasons` tally of the fetched page plus an `excluded_pages` list of URL → reason | `host_id`, `event_type?` (APPEARED_IN_SEARCH/REMOVED_FROM_SEARCH — client-side filter, the API has none), `limit?` (1-100, default: 10), `offset?` |
| `get-excluded-pages` | **Pages dropped from search inside a time window, with `excluded_url_status` for each one.** Built from `REMOVED_FROM_SEARCH` events, deduplicated per URL (latest event wins), so a page that came back is reported under `returned_to_search` instead. Walks the mixed event stream page by page until `limit` excluded pages are collected, then reports `next_offset` (first unread event) / `exhausted` so the walk can continue. Also returns `summary_excluded_pages_count` for cross-checking | `host_id`, `limit?` (1-100 excluded pages, default: 20), `offset?`, `max_requests?` (1-50 page fetches, retries not counted, default: 10), `returned_urls?` (pass the previous `returned_to_search` when continuing a walk) |

There is no dedicated "excluded pages" resource in API v4: `get-summary` carries only the
aggregate `excluded_pages_count`, and the reason a given URL was dropped lives on
`REMOVED_FROM_SEARCH` records of `/search-urls/events/samples`. Since the API has no
server-side event filter, `count` still counts events of **both** types and `limit`/`offset`
page the mixed stream. `get-search-events-samples` reports what one such page contains;
`get-excluded-pages` does the walking, so its `limit` counts excluded pages rather than
events. Per-URL detail beyond the status code: `bad_http_status` for `HTTP_ERROR`, and
`target_url` for the redirect target, canonical address or duplicate.

**These are events in time, not a snapshot of the index.** The same URL appears as
`REMOVED_FROM_SEARCH` and later as `APPEARED_IN_SEARCH` — it dropped out and came back, and
right now it is in search. `get-excluded-pages` therefore deduplicates by URL and keeps the
latest event: a URL whose latest event is an appearance goes to `returned_to_search`, not to
`pages`. Two consequences worth stating out loud:

- an exclusion older than the scanned window is invisible, no matter how current it is;
- deduplication spans **one call**. Continuing from `next_offset` starts with an empty state,
  so a page whose return fell into the previous window would be reported as excluded again —
  pass the previous `returned_to_search` in `returned_urls` to keep the walk honest;
- `excluded_pages_count` from `get-summary` and the length of `pages` are **different kinds
  of number** and are not expected to match. The tool returns the aggregate as
  `summary_excluded_pages_count` and says so in its text, instead of leaving the reader to
  discover a 25x gap on their own.

The per-URL status field is named `excluded_url_status` everywhere — in the tool
descriptions, in `excluded_pages` from `get-search-events-samples` and in `pages` from
`get-excluded-pages`. It is the name from the Yandex reference (`ApiExcludedUrlStatus`), so
it can be grepped against the docs.

### Links (4)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-external-links` | Get external links pointing to the site | `host_id`, `limit?` (1-100), `offset?` |
| `get-external-links-history` | Get external links count history | `host_id`, `date_from?`, `date_to?` |
| `get-broken-internal-links` | List broken internal links: destination URL, the source page linking to it, and when Yandex last checked the link. Records carry `days_since_last_check`, `never_rechecked` and `stale` (last check older than 90 days) | `host_id`, `limit?` (1-100), `offset?` |
| `get-broken-internal-links-history` | Get broken internal links count history | `host_id`, `date_from?`, `date_to?` |

A broken-link record is a snapshot of the last time Yandex checked that link, and that
moment can be months old: when `source_last_access_date` equals `discovery_date`, nothing has
been re-verified since the problem was found, so the link may have been fixed long ago. Each
record therefore carries `days_since_last_check`, `never_rechecked` and `stale` (last check
older than 90 days — `never_rechecked` on its own does not set it), and the text block puts
the warning above the list. A live check of 258 links reported broken across these sites
(2026-09-02) found 10 real 404s; about 80% were 301 redirects. The API is not lying — the old
one-line output just made the count read like an outage.

⚠️ In the Yandex reference the name and the description of `source_last_access_date`
disagree: the name says *source*, the description says "the date the robot last visited the
link's **destination** page". The wording here stays neutral ("last checked") because the
conclusion about the record's age holds under either reading, while a conclusion about a
specific page does not.

### Sitemaps (4)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get-sitemaps` | List all sitemaps for a host | `host_id`, `limit?` (1-100) |
| `get-sitemap` | Get details for a specific sitemap | `host_id`, `sitemap_id` |
| `get-user-sitemaps` | List user-added sitemaps | `host_id`, `limit?` (1-100) |
| `add-sitemap` | **Write.** Add a user sitemap file; returns `sitemap_id`. Additive — the file is removable in the Webmaster panel | `host_id`, `url` |

`add-sitemap` needs the host verified (`404 HOST_NOT_VERIFIED` otherwise). Adding a file that is
already there answers `409 SITEMAP_ALREADY_ADDED`; like every other non-2xx here it surfaces as
an error, and its payload names the existing `sitemap_id` — read it as "already present" rather
than retrying. Removing a sitemap (`DELETE /user-added-sitemaps/{id}`) exists in the API but is
deliberately not wrapped here.

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

These change your Webmaster account, not just read from it.

| Tool | Description | Parameters |
|------|-------------|------------|
| `add-host` | **Write.** Add a site to Webmaster (needs verification afterwards). Additive — undone by `delete-host` | `host_url` (with protocol) |
| `verify-host` | Get verification state and applicable verification methods | `host_id` |
| `delete-host` | **Write.** Remove a site from Webmaster. Irreversible — see [Deleting a host](#deleting-a-host). **Needs `confirm: true`** | `host_id`, `confirm` |

#### Deleting a host

`delete-host` is the only irreversible tool here, and it refuses to run unless the call carries
`confirm: true`:

```json
{ "host_id": "https:example.com:443", "confirm": true }
```

Called without it, the tool returns an error result and sends **nothing** to the Webmaster API:

```
Refused: `delete-host` requires explicit confirmation.

Removing host https:example.com:443 from Yandex Webmaster is irreversible — the site's
verification, its accumulated indexing and search-query history, and its sitemap and
important-URL settings go with it. Adding the same site back creates a fresh host that must be
verified again and starts with no history.

Nothing was sent to the Webmaster API — no host was touched.

To go ahead, call `delete-host` again with host_id https:example.com:443 and `confirm: true`.
To check which site this host ID stands for first, call `get-host-info` or `list-hosts`.
```

`confirm` is optional in the JSON schema on purpose: a missing confirmation has to come back as
that explanation, not as a schema validation error a model cannot act on. Only a literal `true`
counts — `"true"`, `1` and `"yes"` are refused, because a guess at the protocol is not a
decision to delete anything. The tool is also marked `destructiveHint: true` in its MCP
annotations, so clients that surface tool risk can show it before the call.

The other three writes are deliberately left unguarded: `add-host` is additive and undone by
`delete-host`, `add-recrawl-url` only queues a URL for re-crawl against a daily quota that
replenishes, and `add-sitemap` adds a file that stays removable and takes no history with it.
A confirmation on every write would train callers to pass `confirm: true` by
reflex, which is exactly what would defeat it on the one call that matters.

## Common Parameters

- `host_id` -- Host identifier, URL-encoded (e.g., `https:example.com:443`). Get it from `list-hosts`.
- `date_from`, `date_to` -- Dates in YYYY-MM-DD format. Strictly validated (no silent date overflow).
- `limit`, `offset` -- Pagination controls.
- `device_type` -- One of: `ALL`, `DESKTOP`, `MOBILE`, `TABLET`, `MOBILE_AND_TABLET`.

## Caching

The `user_id` is fetched once on the first API call and cached for the session. It is automatically invalidated on 401/403 errors.

## License

MIT
