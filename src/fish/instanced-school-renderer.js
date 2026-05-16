import * as THREE from "three";
import { fishConfig } from "./config.js";
import {
  addFishCurveAttributes,
  enableFishCurveDeformation,
  markFishCurveAttributesNeedsUpdate,
  readFishCurveAttributes,
  updateFishCurveAttributes,
} from "./curve-deformation.js";
import {
  createFishModelInstance,
  disposeFishMaterial,
} from "./model-loader.js";
import {
  readFishDirection,
  writeFishOrientationQuaternion,
} from "./pose.js";

const unitScale = new THREE.Vector3(1, 1, 1);
const outlineScale = new THREE.Vector3(1.13, 1.13, 1.13);
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();

export function createFishMesh(count) {
  const { geometry, material } = createFishModelInstance();
  addFishCurveAttributes(geometry, count);
  enableFishCurveDeformation(material);

  const outlineMaterial = createFishOutlineMaterial();
  enableFishCurveDeformation(outlineMaterial);

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const outlineMesh = new THREE.InstancedMesh(geometry, outlineMaterial, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    fishConfig.renderBoundsRadius,
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
      i === fishConfig.highlightedIndex ? fishConfig.highlightedColor : fishConfig.bodyColor,
    );
  }
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
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
  const curveAttributes = readFishCurveAttributes(mesh.geometry);

  for (let i = 0; i < fish.length; i += 1) {
    const currentFish = fish[i];
    const fishScale = fishConfig.highlightedScale;
    const direction = readFishDirection(currentFish, tmpDirection);
    writeFishOrientationQuaternion(currentFish, direction, tmpQuaternion);
    updateFishCurveAttributes(
      curveAttributes,
      i,
      currentFish,
      tmpQuaternion,
    );

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
  markFishCurveAttributesNeedsUpdate(curveAttributes);
}

function createFishOutlineMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
}
