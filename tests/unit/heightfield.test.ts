import { describe, expect, it } from 'vitest';
import { chunkHeightfield, createPhysicsWorld, initRapier } from '../../src/physics/physics.ts';

/**
 * Pins down Rapier's heightfield layout: samples are column-major, the column
 * follows x and the row follows z, and the field is centred on the collider.
 * A plane that rises with x and separately with z makes any swap visible.
 */
describe('chunk heightfield', () => {
  it('samples the terrain grid in the orientation Rapier expects', async () => {
    const R = await initRapier();
    const vertsX = 9;
    const vertsZ = 9;
    const cm = new Int16Array(vertsX * vertsZ);
    for (let j = 0; j < vertsZ; j += 1) {
      for (let i = 0; i < vertsX; i += 1) cm[j * vertsX + i] = Math.round((10 + i * 2 + j * 0.5) * 100);
    }
    const cells = 4;
    const samples = chunkHeightfield(cm, vertsX, 4, 0, cells);
    expect(samples.length).toBe(25);
    // Sample at column 4 (x index 8), row 0 (z index 0): 10 + 16 + 0.
    expect(samples[4 * 5 + 0]).toBeCloseTo(26, 5);

    const physics = createPhysicsWorld(R);
    const sizeM = cells * 2;
    const minX = 100;
    const minZ = -40;
    physics.addHeightfield(samples, cells, sizeM, minX, minZ);
    physics.world.step();

    const probe = (x: number, z: number): number => {
      const ray = new R.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 });
      const hit = physics.world.castRay(ray, 200, true);
      expect(hit).not.toBeNull();
      return 100 - hit!.timeOfImpact;
    };
    // Vertex (I=4, J=0) is at the chunk's minimum corner.
    expect(probe(minX + 0.01, minZ + 0.01)).toBeCloseTo(10 + 8, 1);
    // Four metres east (two vertices): +4 m of height.
    expect(probe(minX + 4, minZ + 0.01)).toBeCloseTo(10 + 12, 1);
    // Four metres south (two rows): +1 m of height.
    expect(probe(minX + 0.01, minZ + 4)).toBeCloseTo(10 + 8 + 1, 1);
    // Far corner.
    expect(probe(minX + sizeM - 0.01, minZ + sizeM - 0.01)).toBeCloseTo(10 + 16 + 2, 1);
  });
});
