import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function runAuth() {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET environment variables.');
    process.exit(1);
  }

  const authorizeUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${clientId}&scope=metrika:read`;
  console.error(`Opening browser for authorization...\n${authorizeUrl}`);

  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', authorizeUrl], (err) => {
      if (err) console.error('Could not open browser. Visit the URL manually.');
    });
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(cmd, [authorizeUrl], (err) => {
      if (err) console.error('Could not open browser. Visit the URL manually.');
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const code = await new Promise((resolve) => {
    rl.question('\nEnter the authorization code: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Token exchange failed (${response.status}): ${text}`);
    process.exit(1);
  }

  const data = await response.json();
  console.error(`\nToken obtained: ${data.access_token.substring(0, 8)}...`);
  console.error('Set this as YANDEX_METRIKA_TOKEN environment variable.');
}
