import type { Node } from 'three/webgpu';
import { mx_noise_float, vec3 } from 'three/tsl';

/**
 * Procedural asphalt shared by the road ribbons and the terrain's road class so
 * the two agree wherever they overlap. Everything is a function of the world
 * position, which also keeps the coplanar overlaps at junctions invisible.
 */
export function asphaltColor(p: Node<'vec2'>): Node<'vec3'> {
  const grain = mx_noise_float(p.mul(2.5)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(13)).mul(0.5).add(0.5);
  const patch = mx_noise_float(p.mul(0.06)).mul(0.5).add(0.5);
  return vec3(0.105, 0.105, 0.11)
    .mul(grain.mul(0.35).add(0.8))
    .mul(fine.mul(0.22).add(0.88))
    .mul(patch.mul(0.4).add(0.8));
}

export const ASPHALT_ROUGHNESS = 0.86;
