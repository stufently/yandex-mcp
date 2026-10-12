# syntax=docker/dockerfile:1

# One image for all five servers: they share the same two runtime dependencies
# (@modelcontextprotocol/sdk, zod), so five images would be five copies of the
# same layers. The first argument picks the server; the default is `webmaster`,
# so `docker run -i ghcr.io/stufently/yandex-mcp` (and Glama's introspection,
# which runs the image as is) starts a working stdio server without tokens.
#
#   docker run -i --rm -e YANDEX_DIRECT_TOKEN ghcr.io/stufently/yandex-mcp direct

# ---------- deps: production node_modules from bun.lock ----------
# The repo's lockfile is bun.lock (no package-lock.json), so dependencies are
# resolved with Bun against it; --production leaves out the dev-only Biome.
FROM oven/bun:1.4.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/yandex-search-mcp/package.json packages/yandex-search-mcp/
COPY packages/yandex-wordstat-mcp/package.json packages/yandex-wordstat-mcp/
COPY packages/yandex-webmaster-mcp/package.json packages/yandex-webmaster-mcp/
COPY packages/yandex-metrika-mcp/package.json packages/yandex-metrika-mcp/
COPY packages/yandex-direct-mcp/package.json packages/yandex-direct-mcp/
RUN bun install --frozen-lockfile --production --ignore-scripts

# ---------- runtime ----------
FROM node:24.21.0-alpine
LABEL org.opencontainers.image.source="https://github.com/stufently/yandex-mcp" \
      org.opencontainers.image.description="MCP servers for Yandex Search, Wordstat, Webmaster, Metrika and Direct" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
# Read-only for the runtime user whatever umask the checkout was made with:
# a 0077 clone would otherwise give root-owned 0600 sources the `node` user
# cannot read. Nothing under /app is writable at run time.
COPY --from=deps --chmod=a+rX,go-w /app ./
COPY --chmod=a+rX,go-w packages ./packages
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/yandex-mcp
USER node
ENTRYPOINT ["yandex-mcp"]
CMD ["webmaster"]
