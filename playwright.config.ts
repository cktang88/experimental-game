import { defineConfig } from '@playwright/test';

// Runs the real game (Vite dev server + ghost registry) in Chromium.
// Set CHROMIUM_PATH to use a preinstalled browser instead of Playwright's download.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${process.env.GD_WEB_PORT || 5173}`,
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'GHOST_DATA_DIR=${TMPDIR:-/tmp}/gd-e2e-ghosts npm run dev',
    url: `http://localhost:${process.env.GD_WEB_PORT || 5173}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
