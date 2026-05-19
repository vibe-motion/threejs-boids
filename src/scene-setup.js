import * as THREE from "three";

const oceanSurfaceColor = "#d8f5f0";
const oceanUpperColor = "#8acbd0";
const oceanMidDepthColor = "#4f929c";
const oceanDeepColor = "#203f52";
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
  scene.background = transparentBackground ? null : createOceanBackgroundTexture();
  return scene;
}

function createOceanBackgroundTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  const waterDepth = context.createLinearGradient(0, 0, 0, size);
  waterDepth.addColorStop(0, oceanSurfaceColor);
  waterDepth.addColorStop(0.3, oceanUpperColor);
  waterDepth.addColorStop(0.66, oceanMidDepthColor);
  waterDepth.addColorStop(1, oceanDeepColor);

  context.fillStyle = waterDepth;
  context.fillRect(0, 0, size, size);

  context.save();
  context.globalCompositeOperation = "screen";

  const surfaceGlow = context.createRadialGradient(
    size * 0.38,
    -size * 0.08,
    size * 0.02,
    size * 0.38,
    -size * 0.08,
    size * 0.5,
  );
  surfaceGlow.addColorStop(0, "rgba(255, 255, 255, 0.86)");
  surfaceGlow.addColorStop(0.34, "rgba(214, 249, 244, 0.48)");
  surfaceGlow.addColorStop(1, "rgba(214, 249, 244, 0)");
  context.fillStyle = surfaceGlow;
  context.fillRect(0, 0, size, size);

  drawSlantedLightShaft(context, size, {
    apexX: 0.38,
    apexY: -0.08,
    leftX: 0.24,
    leftY: 0.88,
    rightX: 0.84,
    rightY: 0.82,
    blur: 30,
    topColor: "rgba(255, 255, 255, 0.46)",
    midColor: "rgba(226, 255, 251, 0.2)",
  });
  drawSlantedLightShaft(context, size, {
    apexX: 0.4,
    apexY: -0.06,
    leftX: 0.38,
    leftY: 0.74,
    rightX: 0.7,
    rightY: 0.8,
    blur: 10,
    topColor: "rgba(255, 255, 255, 0.5)",
    midColor: "rgba(226, 255, 251, 0.16)",
  });

  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawSlantedLightShaft(
  context,
  size,
  { apexX, apexY, leftX, leftY, rightX, rightY, blur, topColor, midColor },
) {
  const shaftGradient = context.createLinearGradient(
    size * apexX,
    size * apexY,
    size * ((leftX + rightX) * 0.5),
    size * Math.max(leftY, rightY),
  );
  shaftGradient.addColorStop(0, topColor);
  shaftGradient.addColorStop(0.42, midColor);
  shaftGradient.addColorStop(1, "rgba(226, 255, 251, 0)");

  context.save();
  context.filter = `blur(${blur}px)`;
  context.fillStyle = shaftGradient;
  context.beginPath();
  context.moveTo(size * apexX, size * apexY);
  context.bezierCurveTo(
    size * (apexX - 0.04),
    size * 0.2,
    size * (leftX + 0.08),
    size * 0.56,
    size * leftX,
    size * leftY,
  );
  context.quadraticCurveTo(
    size * ((leftX + rightX) * 0.54),
    size * (Math.max(leftY, rightY) + 0.04),
    size * rightX,
    size * rightY,
  );
  context.bezierCurveTo(
    size * (rightX - 0.08),
    size * 0.52,
    size * (apexX + 0.11),
    size * 0.18,
    size * apexX,
    size * apexY,
  );
  context.closePath();
  context.fill();
  context.restore();
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
