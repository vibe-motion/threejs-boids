import * as THREE from "three";

const sceneBackgroundColor = new THREE.Color(0x05070a);

export function createRenderer(canvas) {
  if (!canvas) {
    throw new Error("A canvas element is required to create the renderer.");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createScene({ transparentBackground = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = transparentBackground ? null : sceneBackgroundColor.clone();
  return scene;
}

export function addLighting(scene) {
  const hemiBaseIntensity = 2.6;
  const sunBaseIntensity = 2.2;
  const hemiLight = new THREE.HemisphereLight(0xb7ddff, 0x111820, hemiBaseIntensity);
  scene.add(hemiLight);

  const sun = new THREE.DirectionalLight(0xffffff, sunBaseIntensity);
  sun.position.set(0.8, 13.5, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 42;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  return {
    setIntensity(multiplier) {
      hemiLight.intensity = hemiBaseIntensity * multiplier;
      sun.intensity = sunBaseIntensity * multiplier;
    },
  };
}
