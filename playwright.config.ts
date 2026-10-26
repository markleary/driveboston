import { defineConfig, devices } from '@playwright/test';

// One worker: parallel headless GPU contexts contend for the device and make
// timed driving phases flaky.
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5188/driveboston/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188/driveboston/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The full Chromium build renders headless on the real GPU; the default
        // headless shell has no GPU backend.
        channel: 'chromium',
        viewport: { width: 1600, height: 900 },
        launchOptions: {
          args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
