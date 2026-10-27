import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CHUNK_M, IMAGERY_ZOOM, fetchBox } from './fetch.ts';
import { loadLocalDem } from './terrain.ts';
import { buildRoadGraph } from './roads.ts';
import { buildGround, geoJsonToLocalRings, readGeoJson } from './groundmask.ts';
import { buildBuildings, loadOsmBuildingHeights } from './buildings.ts';
import { buildModels } from './models.ts';
import { buildImagery } from './imagery.ts';
import { packWorld, resolveSpawns } from './pack.ts';
import { rawPath } from './lib/download.ts';
import { GROUND } from '../src/shared/roads.ts';
import type { LonLatBox } from '../src/shared/frame.ts';

const MASK_COLOURS: Record<number, [number, number, number]> = {
  [GROUND.lot]: [120, 110, 95],
  [GROUND.road]: [60, 60, 64],
  [GROUND.sidewalk]: [190, 190, 185],
  [GROUND.building]: [150, 70, 60],
  [GROUND.water]: [50, 90, 160],
  [GROUND.grass]: [70, 140, 60],
  [GROUND.paved]: [160, 150, 140],
  [GROUND.rail]: [110, 80, 120],
  [GROUND.parking]: [100, 100, 110],
};

/** Runs every build step for a box and writes the world file, imagery, debug images and the report. */
export async function buildBox(box: LonLatBox): Promise<void> {
  const t0 = performance.now();
  const lap = (label: string) => console.log(`${label} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  const fetched = await fetchBox(box);
  const rect = fetched.rect;
  const sections: { title: string; lines: string[] }[] = [];

  const dem = await loadLocalDem(box.name, rect);
  sections.push({
    title: 'Terrain',
    lines: [
      `local 1 m grid ${dem.spec.width} x ${dem.spec.height}, heights ${dem.min.toFixed(1)} to ${dem.max.toFixed(1)} m NAVD88, ${dem.nodataCells} cells filled`,
      `water surface (modal height) ${dem.waterLevel.toFixed(2)} m`,
    ],
  });
  lap('terrain');

  const graph = buildRoadGraph(box.name, rect, dem);
  sections.push({ title: 'Road graph', lines: graph.report });
  lap('roads');

  const sidewalks = readGeoJson(fetched.sidewalksPath);
  const buildingsFc = readGeoJson(fetched.buildingsPath);
  const buildingRings = geoJsonToLocalRings(buildingsFc)
    .filter((f) => !['OVHD-WALKWAY', 'MOBILE', 'CONSTRUCT'].includes(String(f.properties.IEL_TYPE ?? '')))
    .map((f) => f.rings);
  const ground = buildGround(dem, graph, sidewalks, buildingRings);
  sections.push({ title: 'Ground mask and curbs', lines: ground.report });
  lap('ground');

  const buildings = buildBuildings(buildingsFc, rect, ground.spec, ground.burned, loadOsmBuildingHeights(box.name));
  sections.push({ title: 'Buildings', lines: buildings.report });
  lap('buildings');

  const models = buildModels(fetched.modelTileKeys, rect, ground.spec, ground.burned, ground.mask, buildings.parts);
  sections.push({ title: 'Building models', lines: models.report });
  lap('models');

  const outDir = path.join('public/data', box.name);
  mkdirSync(outDir, { recursive: true });
  const imagery = await buildImagery(box.name, rect, CHUNK_M, fetched.tileRange, path.join(outDir, 'img'));
  sections.push({ title: 'Imagery', lines: imagery.report });
  lap('imagery');

  const spawnReport: string[] = [];
  const spawns = resolveSpawns(graph, spawnReport);
  const packed = packWorld(box, rect, CHUNK_M, dem, graph, ground, buildings, models, imagery, spawns, IMAGERY_ZOOM);
  writeFileSync(path.join(outDir, 'world.bin.gz'), packed.gz);
  sections.push({ title: 'Spawns', lines: spawnReport });
  sections.push({ title: 'World file', lines: packed.report });
  lap('pack');

  // Debug images for a visual check of the mask and the burned terrain.
  const workDir = rawPath(`${box.name}/work`);
  const W = ground.spec.width;
  const H = ground.spec.height;
  const rgb = new Uint8Array(W * H * 3);
  for (let k = 0; k < W * H; k += 1) {
    const c = MASK_COLOURS[ground.mask[k]] ?? [255, 0, 255];
    rgb.set(c, k * 3);
  }
  for (const curb of ground.curbs) {
    for (const [x, z] of curb.pts) {
      const i = Math.floor((x - ground.spec.originX) / ground.spec.cell);
      const j = Math.floor((z - ground.spec.originZ) / ground.spec.cell);
      if (i >= 0 && j >= 0 && i < W && j < H) rgb.set([255, 240, 80], (j * W + i) * 3);
    }
  }
  await sharp(Buffer.from(rgb.buffer), { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(workDir, 'mask.png'));
  const grey = new Uint8Array(W * H);
  const lo = dem.waterLevel - 1;
  const hi = dem.max;
  for (let k = 0; k < W * H; k += 1) grey[k] = Math.max(0, Math.min(255, ((ground.burned[k] - lo) / (hi - lo)) * 255));
  await sharp(Buffer.from(grey.buffer), { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(workDir, 'heights.png'));

  mkdirSync('docs/reports', { recursive: true });
  const md = [
    `# Pipeline report: ${box.name}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 10)}. Box ${box.south}, ${box.north}, ${box.west}, ${box.east}; local rectangle x ${rect.minX}..${rect.maxX}, z ${rect.minZ}..${rect.maxZ} (${(rect.maxX - rect.minX) / CHUNK_M} x ${(rect.maxZ - rect.minZ) / CHUNK_M} chunks of ${CHUNK_M} m).`,
    '',
    ...sections.flatMap((s) => [`## ${s.title}`, '', ...s.lines.map((l) => `- ${l}`), '']),
  ].join('\n');
  writeFileSync(`docs/reports/${box.name}.md`, md);
  console.log(md);
}
