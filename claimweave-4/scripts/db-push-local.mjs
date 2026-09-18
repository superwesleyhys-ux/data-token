// Initialize the complete exported schema only against a local development DB.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(fileURLToPath(envFile));
if (process.argv.length > 2 || process.env.NODE_ENV === 'production') {
  throw new Error('This command accepts no extra flags and is for development only.');
}
let database;
try {
  database = new URL(process.env.DATABASE_URL ?? '');
} catch {
  throw new Error('Configure a local DATABASE_URL first: npm run setup:local');
}
const localHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !localHosts.includes(database.hostname) ||
  database.searchParams.has('host')
) {
  throw new Error('Refusing to synchronize a non-loopback database.');
}
const prisma = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
if (!existsSync(prisma)) throw new Error('Install the locked dependencies first: npm ci');
const result = spawnSync(process.execPath, [prisma, 'db', 'push', '--skip-generate'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
