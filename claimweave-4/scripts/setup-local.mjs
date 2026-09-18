// Create a local environment without overwriting existing configuration.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../.env', import.meta.url);
if (existsSync(target)) {
  process.stdout.write('Existing .env preserved. Review its local database and app URLs.\n');
} else {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const content = template.replace(
    /^BETTER_AUTH_SECRET=.*$/m,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`,
  );
  writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  process.stdout.write('Created .env with a random auth secret; no model key was added.\n');
}
