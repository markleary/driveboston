import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { Diagnostics } from '../../src/core/diagnostics.ts';

/**
 * A scripted lap of Back Bay on lawful one-way directions: Commonwealth Avenue
 * eastbound from Massachusetts Avenue, Berkeley Street northbound, Beacon
 * Street westbound, Massachusetts Avenue southbound and back onto
 * Commonwealth Avenue. Coordinates are road-graph junctions in the world frame;
 * the bot follows a line to the right of each leg (a lane's width, or `right`
 * metres where the street is wider), steering at a point ahead on it, and
 * takes each turn aiming at the next leg's line, so it keeps to its lane. After
 * the game's reset it puts itself back on its leg if the reset left it elsewhere.
 */
const ROUTE = [
  { name: 'Commonwealth Avenue at Massachusetts Avenue', x: -2144.3, z: 832.0, turn: false },
  { name: 'Commonwealth Avenue at Dartmouth Street', x: -1288.7, z: 521.1, turn: false },
  { name: 'Commonwealth Avenue at Berkeley Street', x: -934.6, z: 392.3, turn: true },
  { name: 'Beacon Street at Berkeley Street', x: -1012.7, z: 176.3, turn: true },
  { name: 'Beacon Street at Dartmouth Street', x: -1372.1, z: 303.5, turn: false },
  { name: 'Beacon Street at Massachusetts Avenue', x: -2222.7, z: 616.8, turn: true },
  { name: 'Commonwealth Avenue at Massachusetts Avenue again', x: -2144.3, z: 832.0, turn: true, right: 2.4 },
  { name: 'Commonwealth Avenue east of Massachusetts Avenue', x: -2087.9, z: 811.5, turn: false },
];
/** On the Commonwealth Avenue surface lane 20 m west of its mid-block node, so the car starts on the ribbon. */
const START = { x: -2208.2, z: 839.5, headingDeg: 76 };
const LANE_RIGHT_M = 1.6;
/** Pure-pursuit lookahead at speed; shorter at low speed so the car settles into its lane after a turn. */
const LOOKAHEAD_M = 18;
/** The turn begins this far before the junction node... */
const TURN_START_M = 14;
/** ...aiming this far past it along the next leg. */
const TURN_EXIT_M = 12;

const SCREENSHOTS = [
  { file: 'comm-ave-mall', spawn: 'Commonwealth Avenue at Dartmouth Street', camera: 'chase' },
  { file: 'newbury-street', spawn: 'Newbury Street at Exeter Street', camera: 'chase' },
  { file: 'copley-square', spawn: 'Copley Square', camera: 'chase' },
  { file: 'esplanade-edge', spawn: 'Storrow Drive at the Esplanade', camera: 'chase' },
  { file: 'prudential-block', spawn: 'Huntington Avenue at Belvidere Street', camera: 'chase' },
  { file: 'aerial-comm-ave', spawn: 'Commonwealth Avenue at Dartmouth Street', camera: 'aerial' },
];

/** Where the bot got stuck and what traffic was near it, for a failing lap's report. */
interface StuckReport {
  t: number;
  waypoint: string;
  x: number;
  z: number;
  headingDeg: number;
  street: string;
  ground: number;
  near: { ahead: number; right: number; headingDeg: number }[];
}

interface LapResult {
  reached: string[];
  resets: number;
  seconds: number;
  topMph: number;
  fpsSamples: { median: number; p95: number }[];
  stepMs: number[];
  calls: number;
  triangles: number;
  heapMb: number;
  stuck: StuckReport[];
}

async function canvasIsNotBlank(page: Page): Promise<{ ok: boolean; variance: number; buckets: number }> {
  const buffer = await page.locator('#game-canvas').screenshot();
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

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__DRIVE_BOSTON__?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__DRIVE_BOSTON__?.frame ?? 0) > 20);
}

// Needs a real GPU: playwright.config.ts leaves this file out on hosted CI.
test.describe('driving', () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test('steering right turns the car clockwise', async ({ page }) => {
    await page.goto('');
    await waitReady(page);
    const result = await page.evaluate(async () => {
      const hooks = window.__DRIVE_BOSTON_HOOKS__!;
      const diag = window.__DRIVE_BOSTON__!;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      hooks.teleport(-2208.2, 839.5, 76);
      await sleep(800);
      hooks.setIntent({ throttle: 1, steer: 0 });
      await sleep(2500);
      const before = diag.car.headingDeg;
      const speedBefore = diag.car.speedMph;
      hooks.setIntent({ throttle: 1, steer: 1 });
      await sleep(1200);
      const after = diag.car.headingDeg;
      hooks.setIntent(null);
      return { before, after, speedBefore, speedAfter: diag.car.speedMph, errors: diag.errors };
    });
    expect(result.errors).toEqual([]);
    expect(result.speedBefore, JSON.stringify(result)).toBeGreaterThan(8);
    const delta = ((result.after - result.before + 540) % 360) - 180;
    expect(delta, JSON.stringify(result)).toBeGreaterThan(8);
  });

  test('a bot laps Commonwealth Avenue, Berkeley, Beacon and Massachusetts Avenue', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const loadStart = Date.now();
    await page.goto('');
    await waitReady(page);
    const loadSeconds = (Date.now() - loadStart) / 1000;

    const lap = await page.evaluate(
      async ({ route, start, laneRight, lookaheadMax, turnStart, turnExit }) => {
        const hooks = window.__DRIVE_BOSTON_HOOKS__!;
        const diag = window.__DRIVE_BOSTON__!;
        hooks.teleport(start.x, start.z, start.headingDeg);
        hooks.setCamera('chase');
        await new Promise((r) => setTimeout(r, 1000));
        const result: LapResult = { reached: [], resets: 0, seconds: 0, topMph: 0, fpsSamples: [], stepMs: [], calls: 0, triangles: 0, heapMb: 0, stuck: [] };
        const t0 = performance.now();
        let index = 0;
        let slowSince = 0;
        let lastSample = 0;
        let recoverIn = 0;
        const describeStuck = (): StuckReport => {
          const car = diag.car;
          const hx = Math.sin((car.headingDeg * Math.PI) / 180);
          const hz = -Math.cos((car.headingDeg * Math.PI) / 180);
          const poses = hooks.trafficPoses();
          const near: StuckReport['near'] = [];
          for (let i = 0; i < poses.length; i += 4) {
            const dx = poses[i] - car.x;
            const dz = poses[i + 1] - car.z;
            if (Math.hypot(dx, dz) > 12) continue;
            const headingDeg = Math.round(((Math.atan2(poses[i + 2], -poses[i + 3]) * 180) / Math.PI + 360) % 360);
            near.push({ ahead: Math.round((dx * hx + dz * hz) * 10) / 10, right: Math.round((dz * hx - dx * hz) * 10) / 10, headingDeg });
          }
          return { t: Math.round(result.seconds), waypoint: route[index].name, x: Math.round(car.x), z: Math.round(car.z), headingDeg: Math.round(car.headingDeg), street: car.street, ground: hooks.groundClassAt(car.x, car.z), near };
        };
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            const now = performance.now();
            result.seconds = (now - t0) / 1000;
            if (index >= route.length || result.seconds > 540) {
              clearInterval(timer);
              hooks.setIntent({ throttle: 0, steer: 0, handbrake: true });
              resolve();
              return;
            }
            const car = diag.car;
            const wp = route[index];
            // Follow the line right of the leg between nodes, steering at a point ahead on it; close to a turn, aim at the next leg's line past the node.
            const dist = Math.hypot(wp.x - car.x, wp.z - car.z);
            const lookahead = Math.max(8, Math.min(lookaheadMax, car.speedMph * 0.447 * 1.2));
            const legFrame = (a: { x: number; z: number }, b: { x: number; z: number; right?: number }) => {
              const legX = b.x - a.x;
              const legZ = b.z - a.z;
              const leg = Math.hypot(legX, legZ);
              const ux = legX / leg;
              const uz = legZ / leg;
              const right = b.right ?? laneRight;
              return {
                leg,
                headingDeg: ((Math.atan2(ux, -uz) * 180) / Math.PI + 360) % 360,
                progress: (car.x - a.x) * ux + (car.z - a.z) * uz,
                lateral: (car.z - a.z) * ux - (car.x - a.x) * uz - right,
                at: (s: number) => ({ x: a.x + ux * s - uz * right, z: a.z + uz * s + ux * right }),
              };
            };
            const frame = legFrame(index > 0 ? route[index - 1] : start, wp);
            if (recoverIn > 0 && (recoverIn -= 1) === 0) {
              // The game's reset put the car on the nearest road facing its lawful way; if that is off the route, put it back on this leg.
              const off = ((frame.headingDeg - car.headingDeg + 540) % 360) - 180;
              if (Math.abs(frame.lateral) > 5 || frame.progress < -10 || Math.abs(off) > 60) {
                const p = frame.at(Math.max(0, Math.min(frame.leg, frame.progress - 8)));
                hooks.teleport(p.x, p.z, frame.headingDeg);
                return;
              }
            }
            const next = route[index + 1];
            const aim = wp.turn && dist < turnStart && next ? legFrame(wp, next).at(turnExit) : frame.at(Math.min(frame.leg, frame.progress + lookahead));
            const dx = aim.x - car.x;
            const dz = aim.z - car.z;
            const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
            const error = ((bearing - car.headingDeg + 540) % 360) - 180;
            if (dist < 9 || (dist < 18 && Math.abs(error) > 100)) {
              result.reached.push(wp.name);
              index += 1;
              return;
            }
            const upcomingTurn = wp.turn && dist < 45;
            const targetMph = upcomingTurn ? 11 : Math.abs(error) > 25 ? 14 : 34;
            const steer = Math.max(-1, Math.min(1, error / 22));
            let throttle = 0;
            if (car.speedMph < targetMph - 1) throttle = 1;
            else if (car.speedMph > targetMph + 4) throttle = -0.5;
            hooks.setIntent({ throttle, steer, handbrake: false, boost: false });
            result.topMph = Math.max(result.topMph, car.speedMph);
            if (car.speedMph < 1.5 && throttle > 0) {
              if (!slowSince) slowSince = now;
              else if (now - slowSince > 4000) {
                result.stuck.push(describeStuck());
                hooks.resetToRoad();
                result.resets += 1;
                recoverIn = 3;
                slowSince = 0;
              }
            } else slowSince = 0;
            if (now - lastSample > 5000) {
              lastSample = now;
              result.fpsSamples.push({ ...diag.fps });
              result.stepMs.push(diag.physics.stepMs);
              result.calls = diag.render.calls;
              result.triangles = diag.render.triangles;
            }
          }, 50);
        });
        hooks.setIntent(null);
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        result.heapMb = memory ? memory.usedJSHeapSize / 1048576 : 0;
        return result;
      },
      { route: ROUTE, start: START, laneRight: LANE_RIGHT_M, lookaheadMax: LOOKAHEAD_M, turnStart: TURN_START_M, turnExit: TURN_EXIT_M },
    );
    await testInfo.attach('lap', { body: JSON.stringify(lap, null, 2), contentType: 'application/json' });
    const traffic = await page.evaluate(() => window.__DRIVE_BOSTON__!.traffic);
    console.log(`traffic: ${traffic.cars} cars driving, ${traffic.parked} parked`);
    console.log(`lap: ${lap.reached.length}/${ROUTE.length} waypoints in ${lap.seconds.toFixed(0)} s, top ${lap.topMph.toFixed(0)} mph, resets ${lap.resets}`);
    for (const s of lap.stuck) console.log(`stuck at ${s.t} s heading for ${s.waypoint}: (${s.x}, ${s.z}) on ${s.street} heading ${s.headingDeg}, ground ${s.ground}, traffic within 12 m ${JSON.stringify(s.near)}`);
    const medians = lap.fpsSamples.map((s) => s.median).sort((a, b) => a - b);
    const p95s = lap.fpsSamples.map((s) => s.p95).sort((a, b) => a - b);
    const steps = [...lap.stepMs].sort((a, b) => a - b);
    const mid = (arr: number[]) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
    console.log(`frame ms: median of medians ${mid(medians).toFixed(1)}, worst median ${(medians.at(-1) ?? 0).toFixed(1)}, median p95 ${mid(p95s).toFixed(1)}, worst p95 ${(p95s.at(-1) ?? 0).toFixed(1)}; draw calls ${lap.calls}; triangles ${lap.triangles}; physics step ms median ${mid(steps).toFixed(2)} max ${(steps.at(-1) ?? 0).toFixed(2)}; heap ${lap.heapMb.toFixed(0)} MB; load ${loadSeconds.toFixed(1)} s`);

    expect(lap.reached, JSON.stringify(lap.reached)).toEqual(ROUTE.map((w) => w.name));
    expect(lap.resets).toBeLessThanOrEqual(2);
    expect(lap.topMph, 'a collision launched the car').toBeLessThan(110);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
    const sample = await canvasIsNotBlank(page);
    expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });
  });

  test('captures the Back Bay screenshots', async ({ page }) => {
    await page.goto('');
    await waitReady(page);
    mkdirSync('docs/screenshots', { recursive: true });
    for (const shot of SCREENSHOTS) {
      await page.evaluate(
        async ({ spawn, camera }) => {
          const hooks = window.__DRIVE_BOSTON_HOOKS__!;
          hooks.setIntent({ throttle: 0, steer: 0, handbrake: true });
          hooks.teleportTo(spawn);
          hooks.setCamera(camera);
          await new Promise((r) => setTimeout(r, 1800));
        },
        shot,
      );
      await page.screenshot({ path: `docs/screenshots/${shot.file}.jpg`, type: 'jpeg', quality: 86 });
    }
    const diag = (await page.evaluate(() => window.__DRIVE_BOSTON__)) as Diagnostics;
    expect(diag.errors).toEqual([]);
  });
});
