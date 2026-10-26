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
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(variant === 'webgl' ? '?webgl' : '');
    // Hosted CI renders in software at under one frame per second, so the waits
    // allow minutes and ask for only a handful of frames.
    await page.waitForFunction(() => window.__DRIVE_BOSTON__?.ready === true, null, { timeout: 240_000 });
    await page.waitForFunction(() => (window.__DRIVE_BOSTON__?.frame ?? 0) > 5);

    const backend = await page.evaluate(() => window.__DRIVE_BOSTON__?.backend);
    if (variant === 'webgl') expect(backend).toBe('webgl2');
    const sample = await canvasIsNotBlank(page);
    expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

    const shot = await page.screenshot();
    await testInfo.attach(`${variant}-${backend}`, { body: shot, contentType: 'image/png' });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
}
