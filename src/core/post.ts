import * as THREE from 'three/webgpu';
import { mrt, normalView, output, pass, renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';

export interface PostStack {
  /** Renders the scene through the stack. */
  render(): void;
  dispose(): void;
}

/**
 * Ground-truth ambient occlusion at half resolution, denoised against depth
 * and normals, multiplied into the scene colour. One scene pass writes colour, view-space normals and depth;
 * the occlusion darkens creases where walls meet the ground and cars meet the
 * road, which the sun's shadow map leaves flat. The pass is not multisampled
 * (WebGPU cannot gather from a multisampled depth texture), so the edges are
 * smoothed by FXAA after tone mapping instead of by MSAA.
 */
export function createPostStack(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): PostStack {
  const post = new THREE.RenderPipeline(renderer);
  post.outputColorTransform = false;
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const colour = scenePass.getTextureNode('output');
  const normal = scenePass.getTextureNode('normal');
  const depth = scenePass.getTextureNode('depth');
  const occlusion = ao(depth, normal, camera);
  occlusion.resolutionScale = 0.5;
  occlusion.radius.value = 1.6;
  occlusion.thickness.value = 1.2;
  occlusion.distanceExponent.value = 1.5;
  const strength = 0.85;
  // The denoise helper is declared without the node extensions; its output is a vec4 whose first channel is the occlusion term.
  const smoothed = denoise(occlusion.getTextureNode(), depth, normal, camera) as unknown as THREE.Node<'vec4'>;
  const factor = smoothed.r.mul(strength).add(1 - strength);
  post.outputNode = fxaa(renderOutput(colour.mul(factor)));
  return {
    render() {
      post.render();
    },
    dispose() {
      occlusion.dispose();
      post.dispose();
    },
  };
}
