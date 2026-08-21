import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function runAuth() {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET environment variables.');
    process.exit(1);
  }

  const authorizeUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${clientId}`;
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
  // Printed in full, on stderr, in a command the user ran themselves and whose
  // whole purpose is to hand them this value. Truncating it to 8 characters
  // made the very next instruction ("set this as ...") impossible to follow.
  console.error('\nToken obtained. Set it as YANDEX_WEBMASTER_TOKEN:\n');
  console.error(`YANDEX_WEBMASTER_TOKEN=${data.access_token}\n`);
  console.error('Treat it like a password: it is not printed again.');
}
