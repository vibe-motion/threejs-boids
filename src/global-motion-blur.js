import * as THREE from "three";

const KERNEL_RADII = [6, 10, 14, 18, 22];
const BLOOM_FACTORS = [1, 0.8, 0.6, 0.4, 0.2];
const DEFAULT_BLOOM_OPTIONS = {
  threshold: 0.28,
  knee: 0.14,
  radius: 0.3,
  strength: 0.38,
  levels: 5,
};

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

// Offscreen targets store linear scene color; only the final canvas pass
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

const prefilterFragmentShader = `
uniform sampler2D sourceTexture;
uniform float threshold;
uniform float knee;

varying vec2 vUv;

float bloomLuminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 color = texture2D(sourceTexture, vUv);
  float luma = bloomLuminance(color.rgb);
  float gate = step(threshold, luma);

  if (knee > 0.0) {
    gate = smoothstep(threshold - knee, threshold + knee, luma);
  }

  gl_FragColor = vec4(color.rgb * gate, color.a);
}
`;

export function createGlobalMotionBlurRenderer(renderer) {
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const bloomLevels = DEFAULT_BLOOM_OPTIONS.levels;
  const currentTarget = createRenderTarget({
    depthBuffer: true,
    name: "RenderEffects.Scene",
  });
  const bloomCompositeTarget = createRenderTarget({
    name: "RenderEffects.BloomComposite",
  });
  const prefilterTarget = createRenderTarget({
    name: "RenderEffects.BloomPrefilter",
  });
  const historyTarget = createRenderTarget({
    name: "RenderEffects.MotionHistory",
  });
  const compositeTarget = createRenderTarget({
    name: "RenderEffects.MotionComposite",
  });
  const horizontalTargets = [];
  const verticalTargets = [];
  const blurMaterials = [];

  for (let i = 0; i < bloomLevels; i += 1) {
    horizontalTargets.push(
      createRenderTarget({
        name: `RenderEffects.BloomHorizontal${i}`,
      }),
    );
    verticalTargets.push(
      createRenderTarget({
        name: `RenderEffects.BloomVertical${i}`,
      }),
    );
    blurMaterials.push(createBlurMaterial(KERNEL_RADII[i]));
  }

  const prefilterMaterial = new THREE.ShaderMaterial({
    name: "BloomPrefilter",
    uniforms: {
      sourceTexture: { value: currentTarget.texture },
      threshold: { value: DEFAULT_BLOOM_OPTIONS.threshold },
      knee: { value: DEFAULT_BLOOM_OPTIONS.knee },
    },
    vertexShader,
    fragmentShader: prefilterFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const bloomCompositeMaterial = createBloomCompositeMaterial(bloomLevels);
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
    render(scene, camera, {
      intensity = 0,
      resetHistory = false,
      bloom = DEFAULT_BLOOM_OPTIONS,
    } = {}) {
      const damp = THREE.MathUtils.clamp(intensity, 0, 0.92);
      const bloomOptions = normalizeBloomOptions(bloom);

      renderSceneToTarget(scene, camera, currentTarget);
      const currentTexture =
        bloomOptions.strength > 0
          ? renderBloom(currentTarget.texture, bloomOptions)
          : currentTarget.texture;

      if (damp <= 0) {
        historyReady = false;
        outputTexture(currentTexture);
        return;
      }

      if (!historyReady || resetHistory) {
        copyTexture(currentTexture, historyTarget);
        outputTexture(currentTexture);
        historyReady = true;
        return;
      }

      blendMaterial.uniforms.currentTexture.value = currentTexture;
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
      bloomCompositeTarget.setSize(renderWidth, renderHeight);
      historyTarget.setSize(renderWidth, renderHeight);
      compositeTarget.setSize(renderWidth, renderHeight);

      let levelWidth = Math.max(1, Math.round(renderWidth / 2));
      let levelHeight = Math.max(1, Math.round(renderHeight / 2));

      prefilterTarget.setSize(levelWidth, levelHeight);

      for (let i = 0; i < bloomLevels; i += 1) {
        horizontalTargets[i].setSize(levelWidth, levelHeight);
        verticalTargets[i].setSize(levelWidth, levelHeight);
        blurMaterials[i].uniforms.invSize.value.set(1 / levelWidth, 1 / levelHeight);

        levelWidth = Math.max(1, Math.round(levelWidth / 2));
        levelHeight = Math.max(1, Math.round(levelHeight / 2));
      }

      historyReady = false;
    },
  };

  function renderSceneToTarget(scene, camera, target) {
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
  }

  function renderBloom(sourceTexture, options) {
    prefilterMaterial.uniforms.sourceTexture.value = sourceTexture;
    prefilterMaterial.uniforms.threshold.value = options.threshold;
    prefilterMaterial.uniforms.knee.value = options.knee;
    renderQuad(prefilterMaterial, prefilterTarget);

    let inputTexture = prefilterTarget.texture;

    for (let i = 0; i < options.levels; i += 1) {
      const blurMaterial = blurMaterials[i];

      blurMaterial.uniforms.inputTexture.value = inputTexture;
      blurMaterial.uniforms.direction.value.set(1, 0);
      renderQuad(blurMaterial, horizontalTargets[i]);

      blurMaterial.uniforms.inputTexture.value = horizontalTargets[i].texture;
      blurMaterial.uniforms.direction.value.set(0, 1);
      renderQuad(blurMaterial, verticalTargets[i]);

      inputTexture = verticalTargets[i].texture;
    }

    bloomCompositeMaterial.uniforms.sceneTexture.value = sourceTexture;
    bloomCompositeMaterial.uniforms.prefilterTexture.value = prefilterTarget.texture;
    bloomCompositeMaterial.uniforms.strength.value = options.strength;
    bloomCompositeMaterial.uniforms.radius.value = options.radius;
    bloomCompositeMaterial.uniforms.levelCount.value = options.levels;

    for (let i = 0; i < bloomLevels; i += 1) {
      bloomCompositeMaterial.uniforms[`bloomTexture${i}`].value = verticalTargets[i].texture;
    }

    renderQuad(bloomCompositeMaterial, bloomCompositeTarget);
    return bloomCompositeTarget.texture;
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
    renderer.clear(true, false, false);
    renderer.render(quadScene, quadCamera);
  }
}

function createBloomCompositeMaterial(levels) {
  const uniforms = {
    sceneTexture: { value: null },
    prefilterTexture: { value: null },
    strength: { value: DEFAULT_BLOOM_OPTIONS.strength },
    radius: { value: DEFAULT_BLOOM_OPTIONS.radius },
    levelCount: { value: levels },
    bloomFactors: { value: BLOOM_FACTORS.slice(0, levels) },
  };
  const samplers = [];
  const samples = [];

  for (let i = 0; i < levels; i += 1) {
    uniforms[`bloomTexture${i}`] = { value: null };
    samplers.push(`uniform sampler2D bloomTexture${i};`);
    samples.push(`
  if (${i} < levelCount) {
    bloom += texture2D(bloomTexture${i}, vUv).rgb
      * lerpBloomFactor(bloomFactors[${i}], radius);
  }`);
  }

  return new THREE.ShaderMaterial({
    name: "BloomComposite",
    uniforms,
    vertexShader,
    fragmentShader: `
uniform sampler2D sceneTexture;
uniform sampler2D prefilterTexture;
uniform float strength;
uniform float radius;
uniform int levelCount;
uniform float bloomFactors[${levels}];
${samplers.join("\n")}

varying vec2 vUv;

float lerpBloomFactor(float factor, float bloomRadius) {
  return mix(factor, 1.2 - factor, bloomRadius);
}

void main() {
  vec4 sceneColor = texture2D(sceneTexture, vUv);
  vec3 bloom = texture2D(prefilterTexture, vUv).rgb * 0.26;
  ${samples.join("\n")}

  vec3 bloomColor = bloom * strength;
  float bloomAlpha = clamp(max(max(bloomColor.r, bloomColor.g), bloomColor.b) * 0.34, 0.0, 1.0);
  gl_FragColor = vec4(sceneColor.rgb + bloomColor, max(sceneColor.a, bloomAlpha));
}
`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function createBlurMaterial(kernelRadius) {
  return new THREE.ShaderMaterial({
    name: `BloomBlur${kernelRadius}`,
    defines: {
      KERNEL_RADIUS: kernelRadius,
    },
    uniforms: {
      inputTexture: { value: null },
      direction: { value: new THREE.Vector2(1, 0) },
      invSize: { value: new THREE.Vector2(1, 1) },
      weights: { value: gaussianWeights(kernelRadius) },
    },
    vertexShader,
    fragmentShader: `
uniform sampler2D inputTexture;
uniform vec2 direction;
uniform vec2 invSize;
uniform float weights[KERNEL_RADIUS];

varying vec2 vUv;

void main() {
  vec3 color = texture2D(inputTexture, vUv).rgb * weights[0];

  for (int i = 1; i < KERNEL_RADIUS; i += 1) {
    float offset = float(i);
    float weight = weights[i];
    vec2 delta = direction * invSize * offset;
    vec3 a = texture2D(inputTexture, vUv + delta).rgb;
    vec3 b = texture2D(inputTexture, vUv - delta).rgb;
    color += (a + b) * weight;
  }

  gl_FragColor = vec4(color, 1.0);
}
`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function createRenderTarget({ depthBuffer = false, name = "RenderEffects.Target" } = {}) {
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  renderTarget.texture.name = name;
  renderTarget.texture.generateMipmaps = false;
  return renderTarget;
}

function gaussianWeights(kernelRadius) {
  const sigma = kernelRadius / 3;
  const weights = [];

  for (let i = 0; i < kernelRadius; i += 1) {
    weights.push(0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma)) / sigma);
  }

  return weights;
}

function normalizeBloomOptions(options = DEFAULT_BLOOM_OPTIONS) {
  const source = {
    ...DEFAULT_BLOOM_OPTIONS,
    ...(options || {}),
  };

  return {
    threshold: Math.max(0, source.threshold),
    knee: Math.max(0, source.knee),
    radius: THREE.MathUtils.clamp(source.radius, 0, 1),
    strength: Math.max(0, source.strength),
    levels: THREE.MathUtils.clamp(
      Math.round(source.levels),
      1,
      DEFAULT_BLOOM_OPTIONS.levels,
    ),
  };
}
