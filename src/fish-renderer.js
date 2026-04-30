import * as THREE from "three";
import { aquariumHalfSize, fishConfig } from "./config.js";

const upAxis = new THREE.Vector3(0, 1, 0);
const unitScale = new THREE.Vector3(1, 1, 1);
const hiddenInstanceScale = new THREE.Vector3(0, 0, 0);
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const TOON_GRADIENT_STOPS = [52, 118, 188, 255];
const HIGHLIGHT_OUTLINE_SCALE = 1.09;

export function createFishMesh(count) {
  const geometry = createFishGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.05,
    vertexColors: true,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    aquariumHalfSize.length() + fishConfig.length,
  );
  mesh.castShadow = true;

  for (let i = 0; i < count; i += 1) {
    mesh.setColorAt(
      i,
      i === fishConfig.highlightedIndex
        ? fishConfig.highlightedColor
        : fishConfig.bodyColor,
    );
  }
  mesh.instanceColor.needsUpdate = true;
  attachHighlightedFish(mesh, geometry);

  return mesh;
}

export function disposeFishMesh(mesh) {
  if (!mesh) return;
  const highlightedMesh = mesh.userData.highlightedFishMesh;
  const highlightedOutline = mesh.userData.highlightedFishOutline;

  mesh.geometry.dispose();
  mesh.material.dispose();

  if (highlightedMesh) {
    disposeFishMaterial(highlightedMesh.material);
  }

  if (highlightedOutline) {
    disposeFishMaterial(highlightedOutline.material);
  }
}

export function updateFishInstances(mesh, fish) {
  const highlightedMesh = mesh.userData.highlightedFishMesh;
  const highlightedIndex = fishConfig.highlightedIndex;
  const shouldShowHighlightedFish = highlightedMesh && highlightedIndex < fish.length;

  if (highlightedMesh) {
    highlightedMesh.visible = shouldShowHighlightedFish;
  }

  for (let i = 0; i < fish.length; i += 1) {
    const currentFish = fish[i];
    const direction = tmpDirection.copy(currentFish.velocity).normalize();
    tmpQuaternion.setFromUnitVectors(upAxis, direction);

    if (i === highlightedIndex && highlightedMesh) {
      highlightedMesh.position.copy(currentFish.position);
      highlightedMesh.quaternion.copy(tmpQuaternion);
      highlightedMesh.scale.copy(unitScale);
      tmpMatrix.compose(currentFish.position, tmpQuaternion, hiddenInstanceScale);
    } else {
      tmpMatrix.compose(currentFish.position, tmpQuaternion, unitScale);
    }

    mesh.setMatrixAt(i, tmpMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
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

function attachHighlightedFish(mesh, geometry) {
  const highlightedMaterial = new THREE.MeshToonMaterial({
    color: fishConfig.highlightedColor,
    gradientMap: createToonGradientMap(),
    vertexColors: true,
  });

  const highlightedMesh = new THREE.Mesh(geometry, highlightedMaterial);
  highlightedMesh.castShadow = true;
  highlightedMesh.renderOrder = 2;

  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x101010,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });

  const outline = new THREE.Mesh(geometry, outlineMaterial);
  outline.scale.setScalar(HIGHLIGHT_OUTLINE_SCALE);
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = 1;

  highlightedMesh.add(outline);
  mesh.add(highlightedMesh);
  mesh.userData.highlightedFishMesh = highlightedMesh;
  mesh.userData.highlightedFishOutline = outline;
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
