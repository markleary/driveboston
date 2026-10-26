import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  float,
  luminance,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  texture,
  uv,
  vec3,
} from 'three/tsl';
import type { ChunkTextures } from './imagery.ts';

/**
 * Ground shading: the aerial imagery gives every square metre its real colour
 * and markings, and the ground-class mask decides how much procedural asphalt,
 * concrete or grass is blended in so cars and shadows baked into the imagery
 * fade while crosswalks and lane lines stay legible.
 */
export function createGroundMaterial(textures: ChunkTextures): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const img = texture(textures.imagery, uv()).rgb;
  const weights = texture(textures.mask, uv());
  const wRoad = weights.r;
  const wWalk = weights.g;
  const wGrass = weights.b;
  const wWater = weights.a;

  const p = positionWorld.xz;
  const grain = mx_noise_float(p.mul(2.5)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(13)).mul(0.5).add(0.5);

  const asphalt = vec3(0.115, 0.115, 0.12).mul(grain.mul(0.35).add(0.8)).mul(fine.mul(0.2).add(0.9));
  const marking = smoothstep(0.42, 0.75, luminance(img));
  const roadColor = mix(mix(img, asphalt, 0.6), vec3(0.72, 0.72, 0.7), marking.mul(0.75));

  const concrete = vec3(0.5, 0.485, 0.46).mul(grain.mul(0.3).add(0.85)).mul(fine.mul(0.12).add(0.94));
  const walkColor = mix(img, concrete, 0.5);

  const turf = vec3(0.16, 0.27, 0.09).mul(grain.mul(0.5).add(0.75));
  const grassColor = mix(img, turf, 0.45);

  const waterColor = vec3(0.04, 0.07, 0.08);

  let color: Node<'vec3'> = img;
  color = mix(color, grassColor, wGrass);
  color = mix(color, walkColor, wWalk);
  color = mix(color, roadColor, wRoad);
  color = mix(color, waterColor, wWater);
  material.colorNode = color;

  let rough: Node<'float'> = float(0.95);
  rough = mix(rough, float(1.0), wGrass);
  rough = mix(rough, float(0.88), wWalk);
  rough = mix(rough, float(0.8).sub(marking.mul(0.2)), wRoad);
  material.roughnessNode = rough;
  material.metalness = 0;
  return material;
}
