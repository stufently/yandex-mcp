# Security

## Reporting a vulnerability

Please report it privately, not in a public issue. Open the
[Security tab](https://github.com/stufently/yandex-mcp/security) of this repository and use
**Report a vulnerability**
([direct link](https://github.com/stufently/yandex-mcp/security/advisories/new)). If that
button is not available, open an issue asking for a private channel — without any details of
the problem.

## What the servers touch

Each of the five servers is a local stdio process. It reads its credentials from environment
variables and sends them only to the Yandex API it wraps. There is no telemetry and no other
outbound host.

| Server | Credential | Sent to | How |
|---|---|---|---|
| Search | `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID` | `searchapi.api.cloud.yandex.net` | `Authorization: Api-Key …` |
| Wordstat | `WORDSTAT_API_KEY` + `WORDSTAT_FOLDER_ID` | `searchapi.api.cloud.yandex.net` | `Authorization: Api-Key …` |
| Webmaster | `YANDEX_WEBMASTER_TOKEN` | `api.webmaster.yandex.net` | `Authorization: OAuth …` |
| Metrika | `YANDEX_METRIKA_TOKEN` | `api-metrica.yandex.net` | `Authorization: OAuth …` |
| Direct | `YANDEX_DIRECT_TOKEN` (+ `YANDEX_DIRECT_CLIENT_LOGIN`) | `api.direct.yandex.com`, or `api-sandbox.direct.yandex.com` with `YANDEX_DIRECT_SANDBOX=true` | `Authorization: Bearer …` |

Where the credentials live:

- **Your MCP client config or shell.** The servers do not store tokens themselves; whatever
  client config, `~/.claude/settings.json` or `.env` you put them in is where they live.
- **Wordstat only:** if the variables are not set, it also reads
  `~/.config/yandex-cloud/wordstat.env`.
- **The OAuth helper** (`… auth` for Webmaster and Metrika) exchanges the code at
  `oauth.yandex.ru` using `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` from your own Yandex OAuth
  app, prints the token once on stderr and does not save it anywhere.

`.env` is in `.gitignore`. A project-level `.mcp.json` or `.cursor/mcp.json` is often committed:
do not paste real tokens into one.

## Least privilege

- **Metrika:** the OAuth helper asks for `metrika:read metrika:write` by default, because
  `create-counter` and `delete-counter` need write. For a token that cannot change anything,
  run it with `YANDEX_METRIKA_SCOPE="metrika:read"`.
- **Wordstat:** a Yandex Cloud service account with the `search-api.webSearch.user` role and an
  API key with scope `yc.search-api.execute` is all it needs.
- **Direct:** try changes against the sandbox first (`YANDEX_DIRECT_SANDBOX=true`).
- **Only set the variables for the servers you enable.** Each server reads its own and ignores
  the rest.

Irreversible operations — `delete-counter`, `delete-host` and the Direct delete/update/bid
tools — refuse to run unless the call passes `confirm: true`. That guards against a slip, not
against an agent that has been told to pass it: an agent that also reads untrusted text
(search results, page content) can be talked into it, so give it a token without write access
when you do not need writes.

## Package names

Install only the `@stufently/` scoped npm names. The unscoped `yandex-*-mcp` names belong to a
different publisher; running them with your Yandex tokens in the environment hands those tokens
to unrelated code.
