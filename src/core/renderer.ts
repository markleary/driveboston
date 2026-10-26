import * as THREE from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

export interface RendererInfo {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
}

/**
 * Creates the WebGPU renderer and waits for its backend to initialise.
 * `?webgl` in the page URL forces the WebGL 2 path so the fallback stays
 * honest; otherwise three.js falls back on its own when WebGPU is missing.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererInfo> {
  const params = new URLSearchParams(window.location.search);
  const forceWebGL = params.has('webgl');
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL,
    powerPreference: 'high-performance',
  });
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const backend: Backend = isWebGPU ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}

/** Matches the drawing buffer to the canvas size and the device pixel ratio. */
export function resizeRenderer(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, maxDpr = 2): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);
  if (canvas.width === bufferWidth && canvas.height === bufferHeight) return false;
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return true;
}
