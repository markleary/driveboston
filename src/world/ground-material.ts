import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, dot, float, fract, mix, mx_noise_float, positionWorld, step, texture, uv, vec3 } from 'three/tsl';
import { ASPHALT_ROUGHNESS, asphaltColor } from './asphalt.ts';
import type { ChunkTextures } from './imagery.ts';

/**
 * Ground shading by the ground-class mask. Grass keeps the aerial imagery for
 * its paths and canopies; sidewalks and lots are procedural concrete and paving
 * that carry only a desaturated hint of the imagery's block-scale tint, so the
 * cars and building shadows baked into the imagery do not read as ground
 * detail. Road cells are pure procedural asphalt, the same as the road ribbons
 * that carry the paint, so the two never disagree.
 */
export function createGroundMaterial(textures: ChunkTextures): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const img = texture(textures.imagery, uv()).rgb;
  // A coarse mip of the imagery keeps the block-scale tint (brick sidewalks, bare lots) without parked cars.
  const imgSoft = texture(textures.imagery, uv()).level(float(2.5)).rgb;
  const weights = texture(textures.mask, uv());
  const wRoad = weights.r;
  const wWalk = weights.g;
  const wGrass = weights.b;
  const wWater = weights.a;

  const p = positionWorld.xz;
  const grain = mx_noise_float(p.mul(2.5)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(13)).mul(0.5).add(0.5);

  const roadColor = asphaltColor(p);

  // Concrete slabs with a joint every 1.5 m on both axes.
  const joint = step(0.47, abs(fract(p.x.div(1.5)).sub(0.5))).max(step(0.47, abs(fract(p.y.div(1.5)).sub(0.5))));
  const concrete = vec3(0.47, 0.455, 0.425).mul(grain.mul(0.3).add(0.85)).mul(fine.mul(0.12).add(0.94)).mul(float(1).sub(joint.mul(0.12)));
  // Shadows in the orthoimagery have a blue cast, so its tint is mostly desaturated before use.
  const lum = dot(imgSoft, vec3(0.3, 0.59, 0.11));
  const tint = mix(imgSoft, vec3(lum), 0.6);
  const walkColor = mix(tint, concrete, 0.8);
  // Yards, areaways and parking strips: worn paving with a little of the block's tint.
  const paving = vec3(0.4, 0.385, 0.36).mul(grain.mul(0.35).add(0.82)).mul(fine.mul(0.1).add(0.95));
  const lotColor = mix(tint, paving, 0.6);

  const turf = vec3(0.16, 0.27, 0.09).mul(grain.mul(0.5).add(0.75));
  const grassColor = mix(img, turf, 0.45);

  const waterColor = vec3(0.04, 0.07, 0.08);

  let color: Node<'vec3'> = lotColor;
  color = mix(color, grassColor, wGrass);
  color = mix(color, walkColor, wWalk);
  color = mix(color, roadColor, wRoad);
  color = mix(color, waterColor, wWater);
  material.colorNode = color;

  let rough: Node<'float'> = float(0.95);
  rough = mix(rough, float(1.0), wGrass);
  rough = mix(rough, float(0.88), wWalk);
  rough = mix(rough, float(ASPHALT_ROUGHNESS), wRoad);
  material.roughnessNode = rough;
  material.metalness = 0;
  return material;
}
