import * as THREE from "three";
import { fishConfig, schoolRenderRadius } from "./config.js";
import { mulberry32 } from "./random.js";

const FISH_COLOR_SEED = 20260503;
const FISH_HUE_JITTER = 0.08;
const FISH_MIN_SATURATION = 0.62;
const FISH_SATURATION_RANGE = 0.24;
const FISH_MIN_LIGHTNESS = 0.5;
const FISH_LIGHTNESS_RANGE = 0.18;
const upAxis = new THREE.Vector3(0, 1, 0);
const unitScale = new THREE.Vector3(1, 1, 1);
const outlineScale = new THREE.Vector3(1.09, 1.09, 1.09);
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();

export function createFishMesh(count) {
  const geometry = createFishGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    flatShading: false,
    vertexColors: true,
  });
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x101010,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const outlineMesh = new THREE.InstancedMesh(geometry, outlineMaterial, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    schoolRenderRadius + fishConfig.length * fishConfig.highlightedScale,
  );
  outlineMesh.boundingSphere = mesh.boundingSphere;
  mesh.castShadow = true;
  mesh.renderOrder = 2;
  outlineMesh.castShadow = false;
  outlineMesh.receiveShadow = false;
  outlineMesh.renderOrder = 1;

  const random = mulberry32(FISH_COLOR_SEED);
  for (let i = 0; i < count; i += 1) {
    mesh.setColorAt(i, createFishInstanceColor(i, random));
  }
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  mesh.add(outlineMesh);
  mesh.userData.outlineMesh = outlineMesh;

  return mesh;
}

function createFishInstanceColor(index, random) {
  const hue = (index * 0.61803398875 + (random() * 2 - 1) * FISH_HUE_JITTER) % 1;
  const saturation = FISH_MIN_SATURATION + random() * FISH_SATURATION_RANGE;
  const lightness = FISH_MIN_LIGHTNESS + random() * FISH_LIGHTNESS_RANGE;
  return tmpColor.setHSL(hue < 0 ? hue + 1 : hue, saturation, lightness);
}

export function disposeFishMesh(mesh) {
  if (!mesh) return;
  const outlineMesh = mesh.userData.outlineMesh;

  mesh.geometry.dispose();
  disposeFishMaterial(mesh.material);

  if (outlineMesh) {
    disposeFishMaterial(outlineMesh.material);
  }
}

export function updateFishInstances(mesh, fish) {
  const outlineMesh = mesh.userData.outlineMesh;

  for (let i = 0; i < fish.length; i += 1) {
    const currentFish = fish[i];
    const direction = tmpDirection.copy(currentFish.velocity).normalize();
    tmpQuaternion.setFromUnitVectors(upAxis, direction);
    const fishScale = i === fishConfig.highlightedIndex ? fishConfig.highlightedScale : 1;

    tmpMatrix.compose(
      currentFish.position,
      tmpQuaternion,
      tmpScale.copy(unitScale).multiplyScalar(fishScale),
    );
    mesh.setMatrixAt(i, tmpMatrix);

    if (outlineMesh) {
      tmpMatrix.compose(
        currentFish.position,
        tmpQuaternion,
        tmpScale.copy(outlineScale).multiplyScalar(fishScale),
      );
      outlineMesh.setMatrixAt(i, tmpMatrix);
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (outlineMesh) {
    outlineMesh.instanceMatrix.needsUpdate = true;
  }
}

export function getFishHeadPose(fish, pose) {
  pose.direction.copy(fish.velocity).normalize();
  pose.position.copy(fish.position).addScaledVector(
    pose.direction,
    fishConfig.length / 2,
  );
  return pose;
}

function createFishGeometry() {
  const geometry = new THREE.ConeGeometry(
    fishConfig.radius,
    fishConfig.length,
    fishConfig.radialSegments,
    fishConfig.heightSegments,
  );
  const vertexColors = new Float32Array(
    geometry.attributes.position.count * 3,
  ).fill(1);
  geometry.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function disposeFishMaterial(material) {
  if (!material) return;

  material.gradientMap?.dispose();
  material.dispose();
}
