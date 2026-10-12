#!/usr/bin/env node
/**
 * Smoke test of the Docker image: run each of the five servers from it over
 * stdio with NO credentials, do the MCP handshake and ask for tools/list.
 * That is what Glama's introspection does with the image, so a server that
 * needs a token just to start would fail here first.
 *
 *   node scripts/docker-smoke.mjs [image]        # default: yandex-mcp:local
 *   DOCKER_SMOKE_USER=1002:1002 node scripts/docker-smoke.mjs
 *
 * DOCKER_SMOKE_USER runs the containers as another uid, to prove the image does
 * not depend on its own `node` user to read its files.
 */
import { execFileSync } from 'node:child_process';
import { handshake } from './lib/list-tools.mjs';
import { SERVERS } from './lib/servers.mjs';

const image = process.argv[2] || 'yandex-mcp:local';
const user = process.env.DOCKER_SMOKE_USER ? ['-u', process.env.DOCKER_SMOKE_USER] : [];

function removeContainer(name) {
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } catch {
    // already gone: --rm removed it when the server exited
  }
}

/** One run per server, plus the default CMD (no argument) that Glama starts. */
const runs = [
  ...SERVERS.map(([pkg, min]) => [pkg, min, pkg.replace(/^yandex-|-mcp$/g, '')]),
  ['yandex-webmaster-mcp', 25, null],
];

let failed = 0;
for (const [pkg, minTools, arg] of runs) {
  const label = arg ?? '(default CMD)';
  const name = `yandex-mcp-smoke-${process.pid}-${arg ?? 'default'}`;
  const command = ['docker', 'run', '-i', '--rm', '--name', name, '--network', 'none', ...user, image];
  if (arg) command.push(arg);
  try {
    const { serverInfo, tools } = await handshake(pkg, { command, clientName: 'docker-smoke', timeoutMs: 60_000 });
    // The servers name themselves `yandex-search`, … but `yandex-direct-mcp`.
    const expected = [pkg, pkg.replace(/-mcp$/, '')];
    if (!expected.includes(serverInfo?.name)) {
      console.error(`FAIL ${label}: initialize returned serverInfo ${JSON.stringify(serverInfo)}, expected ${pkg}`);
      failed++;
    } else if (tools.length < minTools) {
      console.error(`FAIL ${label}: ${tools.length} tools, expected at least ${minTools}`);
      failed++;
    } else {
      console.log(`ok   ${label}: ${serverInfo.name} ${serverInfo.version}, ${tools.length} tools`);
    }
  } catch (err) {
    console.error(`FAIL ${label}: ${err.message}`);
    failed++;
  } finally {
    removeContainer(name);
  }
}

if (failed > 0) {
  console.error(`\n${failed} run(s) failed the Docker smoke test.`);
  process.exit(1);
}
console.log('\nEvery server in the image starts without credentials and exposes its tools.');
