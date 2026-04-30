import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { aquariumFloorY, aquariumSize, waterLevelY } from "./config.js";

const aquariumBoxLineWidth = 0.055;
const obstacleOutlineScale = new THREE.Vector3(1.035, 1.035, 1.035);

export function createRenderer(canvas) {
  if (!canvas) {
    throw new Error("A canvas element is required to create the renderer.");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5d646c);
  return scene;
}

export function addLighting(scene) {
  const hemiBaseIntensity = 2.6;
  const sunBaseIntensity = 2.2;
  const hemiLight = new THREE.HemisphereLight(
    0x9fd8ff,
    0x1b3024,
    hemiBaseIntensity,
  );
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

export function addAquarium(scene) {
  const group = new THREE.Group();
  const effects = [];

  const aquariumEdges = createAquariumEdges();
  group.add(aquariumEdges);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(aquariumSize.x, aquariumSize.z),
    new THREE.MeshStandardMaterial({
      color: 0x2f2f2f,
      roughness: 0.9,
      metalness: 0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = aquariumFloorY - 0.008;
  floor.receiveShadow = true;
  group.add(floor);

  const floorEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(floor.geometry),
    new THREE.LineBasicMaterial({
      color: 0x78b6c7,
      transparent: true,
      opacity: 0.5,
    }),
  );
  floorEdges.rotation.copy(floor.rotation);
  floorEdges.position.copy(floor.position);
  group.add(floorEdges);

  effects.push(addBubbleColumns(group));
  scene.add(group);

  return {
    group,
    update(time) {
      for (const effect of effects) {
        effect.update?.(time);
      }
    },
    setResolution(width, height) {
      aquariumEdges.material.resolution.set(width, height);
    },
  };
}

function createAquariumEdges() {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(createBoxEdgePositions(aquariumSize));

  const material = new LineMaterial({
    color: 0x101010,
    linewidth: aquariumBoxLineWidth,
    worldUnits: true,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });

  return new LineSegments2(geometry, material);
}

function createBoxEdgePositions(size) {
  const halfX = size.x * 0.5;
  const halfY = size.y * 0.5;
  const halfZ = size.z * 0.5;

  return [
    -halfX, -halfY, -halfZ, halfX, -halfY, -halfZ,
    halfX, -halfY, -halfZ, halfX, -halfY, halfZ,
    halfX, -halfY, halfZ, -halfX, -halfY, halfZ,
    -halfX, -halfY, halfZ, -halfX, -halfY, -halfZ,

    -halfX, halfY, -halfZ, halfX, halfY, -halfZ,
    halfX, halfY, -halfZ, halfX, halfY, halfZ,
    halfX, halfY, halfZ, -halfX, halfY, halfZ,
    -halfX, halfY, halfZ, -halfX, halfY, -halfZ,

    -halfX, -halfY, -halfZ, -halfX, halfY, -halfZ,
    halfX, -halfY, -halfZ, halfX, halfY, -halfZ,
    halfX, -halfY, halfZ, halfX, halfY, halfZ,
    -halfX, -halfY, halfZ, -halfX, halfY, halfZ,
  ];
}

export function addWorldAxes(scene) {
  const group = new THREE.Group();
  const axes = [
    { label: "x", color: 0x9b4b4b, direction: new THREE.Vector3(1, 0, 0) },
    { label: "y", color: 0x5d8f58, direction: new THREE.Vector3(0, 1, 0) },
    { label: "z", color: 0x4f6f9d, direction: new THREE.Vector3(0, 0, 1) },
  ];
  const length = 2.45;
  const labelOffset = 0.28;
  const origin = new THREE.Vector3();

  for (const axis of axes) {
    const end = axis.direction.clone().multiplyScalar(length);
    const material = new THREE.LineBasicMaterial({
      color: axis.color,
      transparent: true,
      opacity: 0.46,
    });
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    group.add(new THREE.Line(geometry, material));

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.16, 10),
      new THREE.MeshBasicMaterial({
        color: axis.color,
        transparent: true,
        opacity: 0.5,
      }),
    );
    arrow.position.copy(axis.direction).multiplyScalar(length);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.direction);
    group.add(arrow);

    const label = createAxisLabel(axis.label, axis.color);
    label.position.copy(axis.direction).multiplyScalar(length + labelOffset);
    group.add(label);
  }

  scene.add(group);
  return group;
}

export function addObstacles(scene, obstacles) {
  const obstacleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0.08,
  });
  const obstacleMeshes = [];

  for (const obstacle of obstacles) {
    const geometry = createObstacleGeometry(obstacle);
    const mesh = new THREE.Mesh(
      geometry,
      createObstacleMaterial(obstacle, obstacleMaterial),
    );
    mesh.position.copy(obstacle.position);
    if (obstacle.rotationY) {
      mesh.rotation.y = obstacle.rotationY;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;

    if (obstacle.shape === "plate") {
      const outlineMesh = createObstacleOutline(geometry);
      mesh.add(outlineMesh);
      mesh.userData.outlineMesh = outlineMesh;
    }

    scene.add(mesh);
    obstacleMeshes.push({ obstacle, mesh });
  }

  return obstacleMeshes;
}

function createObstacleOutline(geometry) {
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x101010,
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

function createObstacleMaterial(obstacle, fallbackMaterial) {
  if (obstacle.shape !== "plate") {
    return fallbackMaterial;
  }

  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: createPlateCenterTexture(),
    roughness: 0.52,
    metalness: 0.08,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0.08,
  });

  return [
    faceMaterial,
    faceMaterial,
    edgeMaterial,
    edgeMaterial,
    edgeMaterial,
    edgeMaterial,
  ];
}

function createPlateCenterTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createObstacleGeometry(obstacle) {
  if (obstacle.shape === "box" || obstacle.shape === "plate") {
    return new THREE.BoxGeometry(obstacle.size.x, obstacle.size.y, obstacle.size.z);
  }

  return new THREE.SphereGeometry(obstacle.radius, 32, 18);
}

function createAxisLabel(text, color) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.font = "32px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.globalAlpha = 0.72;
  context.fillText(text, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.38, 0.38, 1);
  return sprite;
}

function addBubbleColumns(scene) {
  const count = 84;
  const geometry = new THREE.SphereGeometry(0.035, 8, 6);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xd8fbff,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.2,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
  });
  const bubbles = new THREE.InstancedMesh(geometry, material, count);
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bubbles);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const starts = [];

  for (let i = 0; i < count; i += 1) {
    const column = i % 3;
    const ring = Math.floor(i / 3);
    const baseX = [-8.4, 0.2, 7.8][column];
    const baseZ = [-5.8, 6.3, -4.7][column];
    starts.push({
      x: baseX + Math.sin(ring * 1.7) * 0.42,
      z: baseZ + Math.cos(ring * 1.31) * 0.36,
      phase: (i * 0.137) % 1,
      size: 0.58 + ((i * 37) % 29) / 50,
      speed: 0.045 + ((i * 17) % 13) * 0.003,
    });
  }

  function update(time) {
    const height = waterLevelY - aquariumFloorY - 0.45;

    for (let i = 0; i < count; i += 1) {
      const bubble = starts[i];
      const t = (bubble.phase + time * bubble.speed) % 1;
      position.set(
        bubble.x + Math.sin(time * 1.2 + i) * 0.08,
        aquariumFloorY + 0.24 + t * height,
        bubble.z + Math.cos(time * 1.45 + i * 0.7) * 0.08,
      );
      const s = bubble.size * (0.55 + t * 0.55);
      scale.setScalar(s);
      matrix.compose(position, quaternion, scale);
      bubbles.setMatrixAt(i, matrix);
    }

    bubbles.instanceMatrix.needsUpdate = true;
  }

  update(0);

  return { update };
}
