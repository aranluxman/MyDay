// Browser tests for phone layouts and accessibility. They run the built app
// against an in-memory mock of the backend (test/e2e/mock.js) with synthetic
// data — nothing reaches the real Supabase project.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
