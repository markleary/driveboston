import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

async function canvasIsNotBlank(page: Page): Promise<{ ok: boolean; variance: number; buckets: number }> {
  const canvas = page.locator('#game-canvas');
  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 8192));
  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const o = pixel * 4;
    const r = png.data[o];
    const g = png.data[o + 1];
    const b = png.data[o + 2];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  return { ok: max - min > 16 && buckets.size > 4, variance: max - min, buckets: buckets.size };
}

for (const variant of ['default', 'webgl'] as const) {
  test(`renders a non-blank scene without errors (${variant})`, async ({ page }, testInfo) => {
    // The sound check below can wait on a few more software-rendered frames.
    test.setTimeout(process.env.CI ? 900_000 : 120_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(variant === 'webgl' ? '?webgl' : '');
    // Hosted CI renders in software at under one frame per second, so the waits
    // allow minutes and ask for only a handful of frames.
    await page.waitForFunction(() => window.__DRIVE_BOSTON__?.ready === true, null, { timeout: 360_000 });
    await page.waitForFunction(() => (window.__DRIVE_BOSTON__?.frame ?? 0) > 2);

    const backend = await page.evaluate(() => window.__DRIVE_BOSTON__?.backend);
    if (variant === 'webgl') expect(backend).toBe('webgl2');
    const sample = await canvasIsNotBlank(page);
    expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

    const shot = await page.screenshot();
    await testInfo.attach(`${variant}-${backend}`, { body: shot, contentType: 'image/png' });

    if (variant === 'default') {
      // A key press starts the sound: the context exists right after the gesture, while the clips
      // need several main-thread turns each to fetch and decode, which on a software-rendered
      // runner (a frame a minute) means longer than the job allows, so only a machine with a GPU
      // waits for the loops to play. The minimap must have drawn the ground mask.
      await page.keyboard.press('KeyW');
      await expect
        .poll(() => page.evaluate(() => window.__DRIVE_BOSTON__!.audio), { timeout: process.env.CI ? 300_000 : 20_000, message: 'the key press did not start the audio context' })
        .toMatchObject({ context: expect.stringMatching(/^(running|suspended)$/), muted: false, failed: 0 });
      if (!process.env.CI) {
        await expect
          .poll(() => page.evaluate(() => window.__DRIVE_BOSTON__!.audio), { timeout: 60_000, message: 'the sound did not start after the key press' })
          .toMatchObject({ ready: true });
      }
      const minimap = await page.locator('#minimap').screenshot();
      const png = PNG.sync.read(minimap);
      const shades = new Set<number>();
      for (let i = 0; i < png.data.length; i += 4 * 97) shades.add((png.data[i] >> 5) * 64 + (png.data[i + 1] >> 5) * 8 + (png.data[i + 2] >> 5));
      expect(shades.size, 'minimap has several colours').toBeGreaterThan(3);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
}
