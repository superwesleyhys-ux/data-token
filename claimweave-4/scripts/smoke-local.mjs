// Disposable local DB only. Tests HTTP/auth/persistence, never model inference.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const base = new URL(process.env.CLAIMWEAVE_SMOKE_URL ?? 'http://localhost:3000');
assert.equal(process.env.CLAIMWEAVE_ALLOW_LOCAL_SMOKE, '1', 'Explicit smoke-test opt-in required');
assert.ok(['localhost', '127.0.0.1', '[::1]', '::1'].includes(base.hostname));
assert.equal(base.protocol, 'http:');

const request = (path, options = {}) =>
  fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(10_000) });
let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await request('/health');
    if (response.ok) {
      assert.equal((await response.json()).status, 'healthy');
      ready = true;
      break;
    }
  } catch {
    // Wait for the local production server, not a remote service.
  }
  await sleep(1000);
}
assert.ok(ready, 'Local server did not become healthy');
const home = await request('/');
assert.equal(home.status, 200);
assert.match(await home.text(), /Reuse local work/);
const unauthorized = await request('/api/projects');
assert.equal(unauthorized.status, 401);

const email = `local-smoke-${randomBytes(8).toString('hex')}@example.test`;
const signup = await request('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base.origin },
  body: JSON.stringify({
    name: 'Local smoke test',
    email,
    password: randomBytes(24).toString('hex'),
  }),
});
assert.ok(signup.ok, `Local signup failed with HTTP ${signup.status}`);
const cookie = signup.headers
  .getSetCookie()
  .map((value) => value.split(';', 1)[0])
  .join('; ');
assert.ok(cookie, 'Signup did not set a session cookie');
const session = await request('/api/auth/get-session', { headers: { cookie } });
assert.equal(session.status, 200);
assert.equal((await session.json()).user.email, email);
const projects = await request('/api/projects', { headers: { cookie } });
assert.equal(projects.status, 200);
assert.deepEqual((await projects.json()).items, []);
const missing = await request('/api/projects/smoke-does-not-exist/claims', { headers: { cookie } });
assert.equal(missing.status, 404);
process.stdout.write(
  'PASS: health, homepage, auth guard, signup/session, project DB read, missing project\n',
);
process.stdout.write(
  'No extraction, verification, benchmark, or external model call was requested.\n',
);
