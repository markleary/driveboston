import { defineConfig, devices } from '@playwright/test';

// One worker: parallel headless GPU contexts contend for the device and make
// timed driving phases flaky.
export default defineConfig({
  testDir: './tests/e2e',
  // Hosted runners have no GPU and render this scene in software at well under
  // one frame per second, which puts the fixed-step simulation into slow
  // motion; the timed driving tests only mean something on a real GPU, so CI
  // keeps the smoke tests, serves them the production build (the dev server
  // hands the browser well over a thousand unbundled modules, which a slow
  // runner takes minutes over) and gives them minutes instead of seconds.
  testIgnore: process.env.CI ? ['**/drive.spec.ts'] : [],
  workers: 1,
  timeout: process.env.CI ? 480_000 : 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5188/driveboston/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CI
    ? {
        command: 'npm run build && npx vite preview --port 5188 --strictPort',
        url: 'http://127.0.0.1:5188/driveboston/',
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : {
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
        // Hosted CI runners have no usable GPU: WebGPU initialises on a software
        // adapter and then drops its instance, so the flags stay off there and
        // both variants exercise the WebGL 2 path.
        launchOptions: {
          args: process.env.CI ? [] : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
