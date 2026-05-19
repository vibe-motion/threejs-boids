import * as THREE from "three";

const obstacleOutlineScale = new THREE.Vector3(1.04, 1.04, 1.04);
const defaultObstacleBodyColor = new THREE.Color(0xffffff);
const defaultObstacleOutlineColor = new THREE.Color(0x101010);

const rendererToneMappingExposure = 1;
const lightingSettings = {
  hemisphereIntensity: 3.38,
  hemisphereSkyColor: "#b7ddff",
  hemisphereGroundColor: "#111820",
  sunIntensity: 0.55,
  sunColor: "#eafffb",
  sunX: -6.5,
  sunY: 11,
  sunZ: 7.5,
};

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
  renderer.toneMappingExposure = rendererToneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createScene({ transparentBackground = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = transparentBackground ? null : new THREE.Color(0xffffff);
  return scene;
}

export function addLighting(scene) {
  const hemiLight = new THREE.HemisphereLight();
  scene.add(hemiLight);

  const sun = new THREE.DirectionalLight();
  sun.castShadow = false;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 42;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  hemiLight.color.set(lightingSettings.hemisphereSkyColor);
  hemiLight.groundColor.set(lightingSettings.hemisphereGroundColor);
  hemiLight.intensity = lightingSettings.hemisphereIntensity;
  sun.color.set(lightingSettings.sunColor);
  sun.intensity = lightingSettings.sunIntensity;
  sun.position.set(lightingSettings.sunX, lightingSettings.sunY, lightingSettings.sunZ);

  return {
    hemiLight,
    sun,
  };
}

export function addObstacles(scene, obstacles) {
  const obstacleMeshes = [];

  for (const obstacle of obstacles) {
    const geometry = createObstacleGeometry(obstacle);
    const mesh = new THREE.Mesh(geometry, createObstacleMaterial(obstacle));
    mesh.position.copy(obstacle.position);
    if (obstacle.rotationY) {
      mesh.rotation.y = obstacle.rotationY;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;

    const outlineMesh = createObstacleOutline(geometry, obstacle);
    mesh.add(outlineMesh);
    mesh.userData.outlineMesh = outlineMesh;

    scene.add(mesh);
    obstacleMeshes.push({ obstacle, mesh });
  }

  return obstacleMeshes;
}

function createObstacleGeometry(obstacle) {
  if ((obstacle.shape === "box" || obstacle.shape === "plate") && obstacle.size) {
    return new THREE.BoxGeometry(obstacle.size.x, obstacle.size.y, obstacle.size.z);
  }

  return new THREE.SphereGeometry(obstacle.radius, 32, 18);
}

function createObstacleMaterial(obstacle) {
  return new THREE.MeshStandardMaterial({
    color: obstacle.bodyColor ?? defaultObstacleBodyColor,
    roughness: 0.52,
    metalness: 0.08,
  });
}

function createObstacleOutline(geometry, obstacle) {
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: obstacle.outlineColor ?? defaultObstacleOutlineColor,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const outlineMesh = new THREE.Mesh(geometry, outlineMaterial);
  outlineMesh.scale.copy(obstacleOutlineScale);
  outlineMesh.castShadow = false;
  outlineMesh.receiveShadow = false;
  outlineMesh.renderOrder = 1;
  return outlineMesh;
}
