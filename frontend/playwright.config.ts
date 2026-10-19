import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.CHRONOS_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1680, height: 1050 },
    colorScheme: 'dark',
  },
  webServer: {
    command: '../scripts/dev.sh',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
