import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.ok(
  process.env.TEST_DATABASE_URL,
  'Set TEST_DATABASE_URL to a disposable PostgreSQL database',
);
const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
const prisma = path.join(root, 'node_modules/prisma/build/index.js');
const migrationStart =
  'npx prisma migrate deploy && npx prisma db push --skip-generate && npm start';

function readStart(directory) {
  // Execute the app's actual TOML command; only the long-running server is stubbed.
  const manifest = readFileSync(path.join(directory, 'polsia.toml'), 'utf8');
  const line = manifest.split('\n').find((value) => value.startsWith('start = '));
  assert.ok(line, 'Deploy manifest must declare its startup command');
  return JSON.parse(line.slice('start = '.length));
}

function optIntoMigrations(directory) {
  const file = path.join(directory, 'polsia.toml');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(
      /^start = .+$/m,
      `start = ${JSON.stringify(migrationStart)}`,
    ),
  );
}

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'polsia-prisma-deployment-'));
  const schema = `template_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const env = { ...process.env, DATABASE_URL: url.href, CHECKPOINT_DISABLE: '1' };
  mkdirSync(path.join(directory, 'prisma/schema'), { recursive: true });
  mkdirSync(path.join(directory, 'prisma/migrations'), { recursive: true });
  for (const file of [
    'polsia.toml',
    'prisma.config.ts',
    'prisma/schema/_base.prisma',
    'prisma/migrations/migration_lock.toml',
  ]) {
    copyFileSync(path.join(root, file), path.join(directory, file));
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ scripts: { start: 'node boot.mjs' } }),
  );
  writeFileSync(
    path.join(directory, 'boot.mjs'),
    "import { writeFileSync } from 'node:fs'; writeFileSync('booted', 'yes');",
  );

  function run(command, args, input) {
    const result = spawnSync(command, args, {
      cwd: directory,
      env,
      input,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }
  function cli(...args) {
    return run(process.execPath, [prisma, ...args]);
  }
  function sql(statement) {
    const result = run(
      process.execPath,
      [prisma, 'db', 'execute', '--url', url.href, '--stdin'],
      statement,
    );
    assert.equal(result.status, 0, result.output);
  }
  t.after(() => {
    try {
      sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  sql(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
  return { directory, cli, sql, start: () => run('/bin/sh', ['-c', readStart(directory)]) };
}

function succeeded(result) {
  assert.equal(result.status, 0, result.output);
}

function addMigration(directory) {
  const migration = path.join(directory, 'prisma/migrations/20260911000000_probe');
  mkdirSync(migration);
  writeFileSync(
    path.join(migration, 'migration.sql'),
    `
    CREATE TABLE "MigrationProbe" ("id" INTEGER PRIMARY KEY, "value" TEXT NOT NULL);
    INSERT INTO "MigrationProbe" VALUES (1, 'applied once');
  `,
  );
}

test('migrate deploy discovers root migrations and applies SQL exactly once', (t) => {
  const app = fixture(t);
  addMigration(app.directory);
  succeeded(app.cli('migrate', 'deploy'));
  succeeded(app.cli('migrate', 'deploy'));
  app.sql(`DO $$ BEGIN
    IF (SELECT count(*) FROM "MigrationProbe" WHERE "value" = 'applied once') <> 1 THEN
      RAISE EXCEPTION 'Migration data was not preserved';
    END IF;
    IF (SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260911000000_probe' AND finished_at IS NOT NULL) <> 1 THEN
      RAISE EXCEPTION 'Migration was not recorded exactly once';
    END IF;
  END $$;`);
});

test('schema-only startup works repeatedly and refuses to drop populated data before boot', (t) => {
  const app = fixture(t);
  succeeded(app.start());
  assert.ok(existsSync(path.join(app.directory, 'booted')));
  const model = path.join(app.directory, 'prisma/schema/probe.prisma');
  writeFileSync(model, 'model StartupProbe {\n id Int @id\n retained String\n}\n');
  succeeded(app.start());
  app.sql(`INSERT INTO "StartupProbe" VALUES (1, 'customer data');`);
  succeeded(app.start());
  rmSync(path.join(app.directory, 'booted'));
  writeFileSync(model, 'model StartupProbe {\n id Int @id\n}\n');
  const rejected = app.start();
  assert.notEqual(rejected.status, 0, rejected.output);
  assert.match(rejected.output, /data loss/i);
  assert.equal(
    existsSync(path.join(app.directory, 'booted')),
    false,
    'Server booted after destructive schema change',
  );
  app.sql(`DO $$ BEGIN
    IF (SELECT "retained" FROM "StartupProbe" WHERE "id" = 1) IS DISTINCT FROM 'customer data' THEN
      RAISE EXCEPTION 'Customer data was not preserved';
    END IF;
  END $$;`);
});

test('default startup restarts a populated db-push app without introducing migration history', (t) => {
  const app = fixture(t);
  writeFileSync(
    path.join(app.directory, 'prisma/schema/legacy-probe.prisma'),
    'model LegacyProbe {\n id Int @id\n value String\n}\n',
  );
  succeeded(app.cli('db', 'push', '--skip-generate'));
  app.sql(`INSERT INTO "LegacyProbe" VALUES (1, 'legacy customer');`);
  succeeded(app.start());
  assert.ok(existsSync(path.join(app.directory, 'booted')));
  rmSync(path.join(app.directory, 'booted'));
  succeeded(app.start());
  assert.ok(existsSync(path.join(app.directory, 'booted')));
  app.sql(`DO $$ BEGIN
    IF (SELECT "value" FROM "LegacyProbe" WHERE "id" = 1) IS DISTINCT FROM 'legacy customer' THEN
      RAISE EXCEPTION 'Legacy data was not preserved';
    END IF;
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
      RAISE EXCEPTION 'Default startup adopted migrations without review';
    END IF;
  END $$;`);
});

test('migration opt-in rejects an unbaselined legacy database before boot without changing customer rows', (t) => {
  const app = fixture(t);
  optIntoMigrations(app.directory);
  app.sql(`CREATE TABLE "LegacyProbe" ("id" INTEGER PRIMARY KEY, "value" TEXT NOT NULL);
    INSERT INTO "LegacyProbe" VALUES (1, 'legacy customer');`);
  addMigration(app.directory);
  const rejected = app.start();
  assert.notEqual(rejected.status, 0, rejected.output);
  assert.match(rejected.output, /P3005/);
  assert.equal(existsSync(path.join(app.directory, 'booted')), false);
  app.sql(`DO $$ BEGIN
    IF (SELECT "value" FROM "LegacyProbe" WHERE "id" = 1) IS DISTINCT FROM 'legacy customer' THEN
      RAISE EXCEPTION 'Legacy data was not preserved';
    END IF;
    IF to_regclass('"MigrationProbe"') IS NOT NULL THEN
      RAISE EXCEPTION 'Migration ran without a baseline';
    END IF;
  END $$;`);
});

test('reviewed migration startup executes SQL before schema sync and only once', (t) => {
  const app = fixture(t);
  optIntoMigrations(app.directory);
  addMigration(app.directory);
  writeFileSync(
    path.join(app.directory, 'prisma/schema/migration-probe.prisma'),
    'model MigrationProbe {\n id Int @id\n value String\n}\n',
  );
  succeeded(app.start());
  assert.ok(existsSync(path.join(app.directory, 'booted')));
  rmSync(path.join(app.directory, 'booted'));
  succeeded(app.start());
  assert.ok(existsSync(path.join(app.directory, 'booted')));
  app.sql(`DO $$ BEGIN
    IF (SELECT count(*) FROM "MigrationProbe" WHERE "value" = 'applied once') <> 1 THEN
      RAISE EXCEPTION 'Startup skipped or repeated the SQL migration';
    END IF;
    IF (SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260911000000_probe' AND finished_at IS NOT NULL) <> 1 THEN
      RAISE EXCEPTION 'Startup did not record migration history';
    END IF;
  END $$;`);
});
