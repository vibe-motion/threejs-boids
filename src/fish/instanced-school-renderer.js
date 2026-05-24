import * as THREE from "three";
import { fishConfig } from "./config.js";
import { readFishDirection, writeFishOrientationQuaternion } from "./pose.js";
import { sampleFishTrailCenters } from "./trail-history.js";

const unitScale = new THREE.Vector3(1, 1, 1);
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpTrailCenters = [];

const trailVertexShader = /* glsl */ `
attribute vec3 trailPrevious;
attribute vec3 trailNext;
attribute float trailProgress;
attribute float trailSide;
attribute vec4 trailStyle;
attribute vec3 trailColor;

uniform float uHeadWidth;
uniform float uTailWidth;
uniform float uTaperPower;

varying float vProgress;
varying float vSide;
varying float vPulse;
varying vec3 vColor;

void main() {
  float progress = clamp(trailProgress, 0.0, 1.0);
  vec4 worldCenter = modelMatrix * vec4(position, 1.0);
  vec3 worldPrevious = (modelMatrix * vec4(trailPrevious, 1.0)).xyz;
  vec3 worldNext = (modelMatrix * vec4(trailNext, 1.0)).xyz;
  vec3 tangent = worldNext - worldPrevious;
  if (dot(tangent, tangent) < 0.000001) {
    tangent = vec3(0.0, 1.0, 0.0);
  }
  tangent = normalize(tangent);

  vec3 viewDirection = normalize(cameraPosition - worldCenter.xyz);
  vec3 sideDirection = cross(viewDirection, tangent);

  if (dot(sideDirection, sideDirection) < 0.000001) {
    sideDirection = cross(vec3(0.0, 1.0, 0.0), tangent);
  }
  if (dot(sideDirection, sideDirection) < 0.000001) {
    sideDirection = vec3(1.0, 0.0, 0.0);
  }
  sideDirection = normalize(sideDirection);

  float taper = 1.0 - pow(progress, uTaperPower);
  float width = mix(uTailWidth, uHeadWidth, taper) * trailStyle.y;
  float pulse = 0.96 + 0.04 * sin(trailStyle.z * 1.7 + progress * 17.0);
  vec3 worldPosition = worldCenter.xyz + sideDirection * trailSide * width * pulse;

  vProgress = progress;
  vSide = trailSide;
  vPulse = pulse;
  vColor = trailColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const trailFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform vec3 uCoreColor;

varying float vProgress;
varying float vSide;
varying float vPulse;
varying vec3 vColor;

void main() {
  float center = 1.0 - abs(vSide);
  float core = smoothstep(0.42, 1.0, center);
  float tailFade = pow(1.0 - smoothstep(0.56, 1.0, vProgress), 1.45);
  float headFade = smoothstep(0.0, 0.035, vProgress);
  float edgeFade = smoothstep(0.0, 0.22, center);
  float energy = mix(0.82, 0.13, vProgress) * vPulse;
  vec3 color = vColor * energy + uCoreColor * core * (0.92 + 0.44 * tailFade);
  float alpha = uOpacity * tailFade * max(headFade, 0.36) * edgeFade;

  gl_FragColor = vec4(color, alpha);
}
`;

export function createFishMesh(count) {
  const group = new THREE.Group();
  group.name = "NeonRibbonSchool";
  group.count = count;

  const trailGeometry = createTrailRibbonGeometry(count);

  const trailMesh = new THREE.Mesh(trailGeometry, createTrailMaterial());
  trailMesh.name = "NeonRibbonTrails";
  trailMesh.frustumCulled = false;
  trailMesh.renderOrder = 4;

  const headMesh = new THREE.InstancedMesh(createArrowConeGeometry(), createHeadMaterial(), count);
  headMesh.name = "NeonArrowHeads";
  headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  headMesh.frustumCulled = false;
  headMesh.renderOrder = 6;

  const headGlowMesh = new THREE.InstancedMesh(
    createArrowConeGeometry({
      lengthScale: 1.18,
      radiusScale: 1.82,
      jitterScale: 0.62,
    }),
    createHeadGlowMaterial(),
    count,
  );
  headGlowMesh.name = "NeonArrowHeadGlow";
  headGlowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  headGlowMesh.frustumCulled = false;
  headGlowMesh.renderOrder = 5;

  group.add(trailMesh, headGlowMesh, headMesh);
  group.userData.trailMesh = trailMesh;
  group.userData.headMesh = headMesh;
  group.userData.headGlowMesh = headGlowMesh;

  return group;
}

export function disposeFishMesh(mesh) {
  if (!mesh) return;

  mesh.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material?.dispose?.();
    }
  });
}

export function updateFishInstances(mesh, fish) {
  const trailMesh = mesh.userData.trailMesh;
  const headMesh = mesh.userData.headMesh;
  const headGlowMesh = mesh.userData.headGlowMesh;
  const fishScale = fishConfig.visualScale ?? 1;

  for (let i = 0; i < fish.length; i += 1) {
    const currentFish = fish[i];
    const direction = readFishDirection(currentFish, tmpDirection);
    writeFishOrientationQuaternion(currentFish, direction, tmpQuaternion);

    tmpMatrix.compose(
      currentFish.position,
      tmpQuaternion,
      tmpScale.copy(unitScale).multiplyScalar(fishScale),
    );

    headMesh.setMatrixAt(i, tmpMatrix);
    headGlowMesh.setMatrixAt(i, tmpMatrix);
  }

  updateTrailGeometry(trailMesh.geometry, fish);
  headMesh.instanceMatrix.needsUpdate = true;
  headGlowMesh.instanceMatrix.needsUpdate = true;
}

function createTrailRibbonGeometry(count) {
  const segments = fishConfig.ribbonSegments;
  const verticesPerFish = (segments + 1) * 2;
  const vertexCount = count * verticesPerFish;
  const indexCount = count * segments * 6;
  const positions = new Float32Array(vertexCount * 3);
  const previous = new Float32Array(vertexCount * 3);
  const next = new Float32Array(vertexCount * 3);
  const progressValues = new Float32Array(vertexCount);
  const sideValues = new Float32Array(vertexCount);
  const trailStyles = new Float32Array(vertexCount * 4);
  const trailColors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const lengthScales = new Float32Array(count);
  let indexOffset = 0;

  for (let fishIndex = 0; fishIndex < count; fishIndex += 1) {
    const lengthScale = 0.74 + seeded01(fishIndex, 13.17) * 0.62;
    const widthScale = 0.72 + seeded01(fishIndex, 51.39) * 0.56;
    const phase = seeded01(fishIndex, 91.73) * Math.PI * 2;
    const spark = seeded01(fishIndex, 7.11);
    const colorBlend = seeded01(fishIndex, 29.47);
    const colorR = THREE.MathUtils.lerp(0.1, 0.3, colorBlend);
    const colorG = THREE.MathUtils.lerp(0.62, 1.08, spark);
    const colorB = THREE.MathUtils.lerp(0.92, 1.46, 1 - colorBlend * 0.35);
    const fishVertexOffset = fishIndex * verticesPerFish;
    lengthScales[fishIndex] = lengthScale;

    for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
      const progress = segmentIndex / segments;

      for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
        const vertexIndex = fishVertexOffset + segmentIndex * 2 + sideIndex;
        const styleOffset = vertexIndex * 4;
        const colorOffset = vertexIndex * 3;
        const uvOffset = vertexIndex * 2;
        const side = sideIndex === 0 ? -1 : 1;

        progressValues[vertexIndex] = progress;
        sideValues[vertexIndex] = side;
        trailStyles[styleOffset] = lengthScale;
        trailStyles[styleOffset + 1] = widthScale;
        trailStyles[styleOffset + 2] = phase;
        trailStyles[styleOffset + 3] = spark;
        trailColors[colorOffset] = colorR;
        trailColors[colorOffset + 1] = colorG;
        trailColors[colorOffset + 2] = colorB;
        uvs[uvOffset] = sideIndex;
        uvs[uvOffset + 1] = progress;
      }
    }

    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
      const a = fishVertexOffset + segmentIndex * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[indexOffset] = a;
      indices[indexOffset + 1] = c;
      indices[indexOffset + 2] = b;
      indices[indexOffset + 3] = b;
      indices[indexOffset + 4] = c;
      indices[indexOffset + 5] = d;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("position", createDynamicAttribute(positions, 3));
  geometry.setAttribute("trailPrevious", createDynamicAttribute(previous, 3));
  geometry.setAttribute("trailNext", createDynamicAttribute(next, 3));
  geometry.setAttribute("trailProgress", new THREE.BufferAttribute(progressValues, 1));
  geometry.setAttribute("trailSide", new THREE.BufferAttribute(sideValues, 1));
  geometry.setAttribute("trailStyle", new THREE.BufferAttribute(trailStyles, 4));
  geometry.setAttribute("trailColor", new THREE.BufferAttribute(trailColors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.userData.count = count;
  geometry.userData.segments = segments;
  geometry.userData.verticesPerFish = verticesPerFish;
  geometry.userData.lengthScales = lengthScales;
  geometry.computeBoundingSphere();
  return geometry;
}

function updateTrailGeometry(geometry, fish) {
  const segments = geometry.userData.segments;
  const verticesPerFish = geometry.userData.verticesPerFish;
  const lengthScales = geometry.userData.lengthScales;
  const positionAttribute = geometry.getAttribute("position");
  const previousAttribute = geometry.getAttribute("trailPrevious");
  const nextAttribute = geometry.getAttribute("trailNext");
  const positions = positionAttribute.array;
  const previous = previousAttribute.array;
  const next = nextAttribute.array;
  const fishScale = fishConfig.visualScale ?? 1;

  ensureTrailCenterScratch(segments + 1);

  for (let fishIndex = 0; fishIndex < fish.length; fishIndex += 1) {
    const currentFish = fish[fishIndex];
    const fishVertexOffset = fishIndex * verticesPerFish;
    const trailLength = fishConfig.ribbonLength * (lengthScales[fishIndex] ?? 1) * fishScale;

    sampleFishTrailCenters(currentFish, trailLength, segments, tmpTrailCenters);

    for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
      const centerPoint = tmpTrailCenters[segmentIndex];
      const previousPoint = tmpTrailCenters[Math.max(0, segmentIndex - 1)];
      const nextPoint = tmpTrailCenters[Math.min(segments, segmentIndex + 1)];

      for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
        const vertexOffset = (fishVertexOffset + segmentIndex * 2 + sideIndex) * 3;

        positions[vertexOffset] = centerPoint.x;
        positions[vertexOffset + 1] = centerPoint.y;
        positions[vertexOffset + 2] = centerPoint.z;
        previous[vertexOffset] = previousPoint.x;
        previous[vertexOffset + 1] = previousPoint.y;
        previous[vertexOffset + 2] = previousPoint.z;
        next[vertexOffset] = nextPoint.x;
        next[vertexOffset + 1] = nextPoint.y;
        next[vertexOffset + 2] = nextPoint.z;
      }
    }
  }

  positionAttribute.needsUpdate = true;
  previousAttribute.needsUpdate = true;
  nextAttribute.needsUpdate = true;
}

function createDynamicAttribute(array, itemSize) {
  const attribute = new THREE.BufferAttribute(array, itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

function ensureTrailCenterScratch(count) {
  while (tmpTrailCenters.length < count) {
    tmpTrailCenters.push(new THREE.Vector3());
  }
}

function createTrailMaterial() {
  return new THREE.ShaderMaterial({
    name: "NeonRibbonTrailMaterial",
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uHeadWidth: { value: fishConfig.ribbonHeadWidth },
      uTailWidth: { value: fishConfig.ribbonTailWidth },
      uTaperPower: { value: fishConfig.ribbonTaperPower },
      uOpacity: { value: fishConfig.ribbonOpacity },
      uCoreColor: { value: new THREE.Color(0.48, 1.0, 1.48) },
    },
    vertexShader: trailVertexShader,
    fragmentShader: trailFragmentShader,
  });
}

function createHeadMaterial() {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.9, 1.9, 2.7),
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function createHeadGlowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.26, 1.22, 2.2),
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function createArrowConeGeometry({ lengthScale = 1, radiusScale = 1, jitterScale = 1 } = {}) {
  const length = fishConfig.arrowLength * lengthScale;
  const geometry = new THREE.ConeGeometry(
    fishConfig.arrowRadius * radiusScale,
    length,
    fishConfig.arrowRadialSegments,
    fishConfig.arrowHeightSegments,
    false,
  );

  geometry.translate(0, -length / 2, 0);

  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const radialLength = Math.hypot(x, z);

    if (radialLength <= 0.000001) {
      continue;
    }

    const angle = Math.atan2(z, x);
    const tailProgress = THREE.MathUtils.clamp(-y / Math.max(0.0001, length), 0, 1);
    const saw = Math.sin(angle * 5 + tailProgress * 12.0) * 0.12;
    const spike = Math.sin(angle * 9 - tailProgress * 8.0) * 0.08;
    const scale = 1 + (saw + spike) * tailProgress * jitterScale;

    position.setXYZ(i, x * scale, y, z * scale);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function seeded01(index, salt) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
