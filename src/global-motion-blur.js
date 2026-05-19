import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const blendFragmentShader = `
uniform sampler2D currentTexture;
uniform sampler2D historyTexture;
uniform float damp;

varying vec2 vUv;

void main() {
  vec4 currentColor = texture2D(currentTexture, vUv);
  vec4 historyColor = texture2D(historyTexture, vUv);
  gl_FragColor = mix(currentColor, historyColor, damp);
}
`;

const copyFragmentShader = `
uniform sampler2D sourceTexture;

varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(sourceTexture, vUv);
}
`;

// Offscreen blur targets store linear scene color; only the final canvas pass
// should apply the renderer's tone mapping and output color space.
const outputFragmentShader = `
uniform sampler2D sourceTexture;

varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(sourceTexture, vUv);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createGlobalMotionBlurRenderer(renderer) {
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const currentTarget = createRenderTarget({ depthBuffer: true });
  const historyTarget = createRenderTarget();
  const compositeTarget = createRenderTarget();
  const blendMaterial = new THREE.ShaderMaterial({
    uniforms: {
      currentTexture: { value: currentTarget.texture },
      historyTexture: { value: historyTarget.texture },
      damp: { value: 0 },
    },
    vertexShader,
    fragmentShader: blendFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sourceTexture: { value: currentTarget.texture },
    },
    vertexShader,
    fragmentShader: copyFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const outputMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sourceTexture: { value: currentTarget.texture },
    },
    vertexShader,
    fragmentShader: outputFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });
  let historyReady = false;

  quad.frustumCulled = false;
  quadScene.add(quad);

  return {
    render(scene, camera, { intensity = 0, resetHistory = false } = {}) {
      const damp = THREE.MathUtils.clamp(intensity, 0, 0.92);

      if (damp <= 0) {
        historyReady = false;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }

      renderSceneToTarget(scene, camera, currentTarget);

      if (!historyReady || resetHistory) {
        copyTexture(currentTarget.texture, historyTarget);
        outputTexture(currentTarget.texture);
        historyReady = true;
        return;
      }

      blendMaterial.uniforms.currentTexture.value = currentTarget.texture;
      blendMaterial.uniforms.historyTexture.value = historyTarget.texture;
      blendMaterial.uniforms.damp.value = damp;
      renderQuad(blendMaterial, compositeTarget);
      copyTexture(compositeTarget.texture, historyTarget);
      outputTexture(compositeTarget.texture);
    },

    reset() {
      historyReady = false;
    },

    setSize(width, height, pixelRatio = 1) {
      const renderWidth = Math.max(1, Math.round(width * pixelRatio));
      const renderHeight = Math.max(1, Math.round(height * pixelRatio));
      currentTarget.setSize(renderWidth, renderHeight);
      historyTarget.setSize(renderWidth, renderHeight);
      compositeTarget.setSize(renderWidth, renderHeight);
      historyReady = false;
    },
  };

  function renderSceneToTarget(scene, camera, target) {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
  }

  function copyTexture(texture, target) {
    copyMaterial.uniforms.sourceTexture.value = texture;
    renderQuad(copyMaterial, target);
  }

  function outputTexture(texture) {
    outputMaterial.uniforms.sourceTexture.value = texture;
    renderQuad(outputMaterial, null);
  }

  function renderQuad(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(quadScene, quadCamera);
  }
}

function createRenderTarget({ depthBuffer = false } = {}) {
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer,
    stencilBuffer: false,
  });
  renderTarget.texture.name = "GlobalMotionBlur.Target";
  return renderTarget;
}
