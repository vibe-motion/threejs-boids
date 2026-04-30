import * as THREE from "three";
import { aquariumHalfSize, fishConfig } from "./config.js";

const upAxis = new THREE.Vector3(0, 1, 0);
const unitScale = new THREE.Vector3(1, 1, 1);
const outlineScale = new THREE.Vector3(1.09, 1.09, 1.09);
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const TOON_GRADIENT_STOPS = [52, 118, 188, 255];

export function createFishMesh(count) {
  const geometry = createFishGeometry();
  const material = new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap: createToonGradientMap(),
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
    aquariumHalfSize.length() + fishConfig.length,
  );
  outlineMesh.boundingSphere = mesh.boundingSphere;
  mesh.castShadow = true;
  mesh.renderOrder = 2;
  outlineMesh.castShadow = false;
  outlineMesh.receiveShadow = false;
  outlineMesh.renderOrder = 1;

  for (let i = 0; i < count; i += 1) {
    mesh.setColorAt(
      i,
      i === fishConfig.highlightedIndex
        ? fishConfig.highlightedColor
        : fishConfig.bodyColor,
    );
  }
  mesh.instanceColor.needsUpdate = true;
  mesh.add(outlineMesh);
  mesh.userData.outlineMesh = outlineMesh;

  return mesh;
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

    tmpMatrix.compose(currentFish.position, tmpQuaternion, unitScale);
    mesh.setMatrixAt(i, tmpMatrix);

    if (outlineMesh) {
      tmpMatrix.compose(currentFish.position, tmpQuaternion, outlineScale);
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
    1,
  );
  const vertexColors = new Float32Array(
    geometry.attributes.position.count * 3,
  ).fill(1);
  geometry.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createToonGradientMap() {
  const data = new Uint8Array(TOON_GRADIENT_STOPS.length * 4);

  for (let i = 0; i < TOON_GRADIENT_STOPS.length; i += 1) {
    const offset = i * 4;
    const value = TOON_GRADIENT_STOPS[i];
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }

  const texture = new THREE.DataTexture(
    data,
    TOON_GRADIENT_STOPS.length,
    1,
    THREE.RGBAFormat,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function disposeFishMaterial(material) {
  if (!material) return;

  material.gradientMap?.dispose();
  material.dispose();
}
