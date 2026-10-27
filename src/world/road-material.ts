import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  float,
  floor,
  fract,
  fwidth,
  mix,
  mx_noise_float,
  positionView,
  positionWorld,
  round,
  smoothstep,
  step,
  sub,
  vec3,
  vec4,
} from 'three/tsl';
import { ASPHALT_ROUGHNESS, asphaltColor } from './asphalt.ts';
import type { RoadGeometry } from './road-geometry.ts';

export function roadGeometryToThree(g: RoadGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(g.across, 1));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(g.along, 1));
  geometry.setAttribute('aRoad', new THREE.Float32BufferAttribute(g.road, 4));
  geometry.setAttribute('aEnds', new THREE.Float32BufferAttribute(g.ends, 4));
  geometry.setIndex(new THREE.Uint32BufferAttribute(g.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Asphalt with analytic paint: a double yellow centre line on two-way streets,
 * dashed white dividers between same-direction lanes, solid lines along parking
 * lanes, continental crosswalk bars and stop lines at junction ends, all worn by
 * noise and faded with distance. Lane geometry comes from the vertex attributes
 * written by buildRoadGeometry.
 */
export function createRoadMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const across = float(attribute('aAcross', 'float'));
  const along = float(attribute('aAlong', 'float'));
  const road = vec4(attribute('aRoad', 'vec4'));
  const ends = vec4(attribute('aEnds', 'vec4'));
  const hw = road.x;
  const laneW = road.y;
  const lanes = road.z;
  const oneway = road.w;
  const twoway = float(1).sub(oneway);
  const len = ends.x;
  const trimA = ends.y;
  const trimB = ends.z;
  const bits = ends.w;
  const bitAt = (k: number) => step(0.5, fract(bits.div(2 ** (k + 1))));
  const cwA = bitAt(0);
  const cwB = bitAt(1);
  const stA = bitAt(2);
  const stB = bitAt(3);

  const p = positionWorld.xz;
  const aa = fwidth(across).max(0.004);
  // 1 inside a band of the given half width around the centre, anti-aliased by the pixel footprint.
  const band = (v: Node<'float'>, centre: Node<'float'> | number, halfW: number) =>
    float(1).sub(smoothstep(float(halfW).sub(aa), float(halfW).add(aa), abs(sub(v, centre))));

  const sA = along.sub(trimA);
  const sB = len.sub(trimB).sub(along);
  const inZone = step(0, sA).mul(step(0, sB));
  // Longitudinal paint stops short of a crosswalk's stop line.
  const longZone = inZone.mul(step(cwA.mul(5.6), sA)).mul(step(cwB.mul(5.6), sB));

  const yellow = twoway.mul(longZone).mul(band(across, 0.11, 0.055).add(band(across, -0.11, 0.055)));

  const dhw = lanes.mul(laneW).mul(0.5);
  const u = across.add(dhw);
  const du = abs(u.sub(round(u.div(laneW)).mul(laneW)));
  const interior = step(laneW.mul(0.5), u).mul(step(u, dhw.mul(2).sub(laneW.mul(0.5))));
  const notCentre = mix(float(1), step(0.3, abs(across)), twoway);
  const dash = step(fract(sA.div(12)), 0.25);
  const dividers = longZone.mul(interior).mul(notCentre).mul(dash).mul(band(du, 0, 0.05));

  const parking = step(1.8, hw.sub(dhw)).mul(longZone).mul(band(abs(across), dhw, 0.05));

  const bars = step(fract(across.add(hw).div(1.3)), 0.5);
  const crosswalk = cwA.mul(step(0.6, sA)).mul(step(sA, 3.6)).add(cwB.mul(step(0.6, sB)).mul(step(sB, 3.6))).mul(bars);
  const stopB = stB.mul(step(4.6, sB)).mul(step(sB, 5.1)).mul(mix(step(0.25, across), float(1), oneway));
  const stopA = stA.mul(step(4.6, sA)).mul(step(sA, 5.1)).mul(twoway).mul(step(0.25, across.negate()));
  const white = clamp(dividers.add(parking).add(crosswalk).add(stopA).add(stopB), 0, 1);

  const wearNoise = mx_noise_float(p.mul(0.7)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(13)).mul(0.5).add(0.5);
  const wear = smoothstep(0.1, 0.8, wearNoise).mul(0.55).add(0.45).mul(fine.mul(0.3).add(0.85));
  const dist = positionView.z.negate();
  const visible = float(0.3).add(float(0.7).mul(float(1).sub(smoothstep(120, 450, dist))));
  const paintW = white.mul(wear).mul(visible);
  const paintY = yellow.mul(wear).mul(visible);

  // Tyre tracks polish the asphalt a little either side of each lane centre.
  const lanePos = abs(u.sub(floor(u.div(laneW)).add(0.5).mul(laneW)));
  const inLanes = step(0, u).mul(step(u, dhw.mul(2)));
  const track = smoothstep(0.45, 0.7, lanePos).mul(float(1).sub(smoothstep(0.9, 1.1, lanePos))).mul(inLanes);

  const base = asphaltColor(p).mul(float(1).sub(track.mul(0.08)));
  let color: Node<'vec3'> = base;
  color = mix(color, vec3(0.8, 0.8, 0.77), paintW);
  color = mix(color, vec3(0.86, 0.66, 0.14), paintY);
  material.colorNode = color;
  const paint = clamp(paintW.add(paintY), 0, 1);
  material.roughnessNode = float(ASPHALT_ROUGHNESS).sub(track.mul(0.06)).mul(float(1).sub(paint)).add(paint.mul(0.62));
  material.metalness = 0;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  return material;
}
