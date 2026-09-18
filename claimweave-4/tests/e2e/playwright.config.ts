import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: '.',
  testMatch:
    /(?:projects-workspace|claim-citations|evidence-verification|grounded-answer|claim-extraction-benchmark|api-keys|url-batch)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command:
      'node ai-fixture.mjs & AI_PID=$!; node source-fixture.mjs & SOURCE_PID=$!; trap "kill $AI_PID $SOURCE_PID" EXIT; SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 POLSIA_AI_BASE_URL=http://127.0.0.1:3200 POLSIA_API_KEY=local-e2e-key CLAIMWEAVE_TEST_SOURCE_ORIGIN=http://127.0.0.1:3300 BETTER_AUTH_SECRET=local-e2e-secret-32-characters-long-1234 BETTER_AUTH_URL=http://127.0.0.1:3100 BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3100 PORT=3100 npm run build && SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 POLSIA_AI_BASE_URL=http://127.0.0.1:3200 POLSIA_API_KEY=local-e2e-key CLAIMWEAVE_TEST_SOURCE_ORIGIN=http://127.0.0.1:3300 BETTER_AUTH_SECRET=local-e2e-secret-32-characters-long-1234 BETTER_AUTH_URL=http://127.0.0.1:3100 BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3100 PORT=3100 npm start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
