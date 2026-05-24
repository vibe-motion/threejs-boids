import * as THREE from "three";
import { fishConfig } from "./config.js";
import {
  readFishDirection,
  writeFishOrientationQuaternion,
} from "./pose.js";

const unitScale = new THREE.Vector3(1, 1, 1);
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpInverseQuaternion = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpCurveBend = new THREE.Vector3();

const trailVertexShader = /* glsl */ `
attribute float trailProgress;
attribute float trailSide;
attribute vec4 trailStyle;
attribute vec4 trailCurve;
attribute vec3 trailColor;

uniform float uTrailLength;
uniform float uHeadWidth;
uniform float uTailWidth;
uniform float uWaveAmplitude;
uniform float uTaperPower;

varying float vProgress;
varying float vSide;
varying float vPulse;
varying vec3 vColor;

vec3 readTrailCenter(float progress) {
  float length = uTrailLength * trailStyle.x;
  float y = -progress * length;
  float curveEnvelope = progress * progress * (1.18 - progress * 0.24);
  float waveEnvelope = progress * (1.0 - progress * 0.18);
  float swimDrive = clamp(trailCurve.z, 0.0, 1.0);
  float phase = trailCurve.w + trailStyle.z;
  float fastWave = sin(phase + progress * 11.7);
  float slowWave = cos(phase * 0.73 + progress * 7.2);

  return vec3(
    trailCurve.x * curveEnvelope * length * 0.34
      + fastWave * uWaveAmplitude * waveEnvelope * (0.32 + swimDrive * 0.82),
    y,
    trailCurve.y * curveEnvelope * length * 0.34
      + slowWave * uWaveAmplitude * waveEnvelope * (0.22 + swimDrive * 0.56)
  );
}

void main() {
  float progress = clamp(trailProgress, 0.0, 1.0);
  vec3 center = readTrailCenter(progress);
  vec3 previousCenter = readTrailCenter(max(0.0, progress - 0.014));
  vec3 nextCenter = readTrailCenter(min(1.0, progress + 0.014));

#ifdef USE_INSTANCING
  mat4 instanceTransform = instanceMatrix;
#else
  mat4 instanceTransform = mat4(1.0);
#endif

  vec4 worldCenter = modelMatrix * instanceTransform * vec4(center, 1.0);
  vec3 worldPrevious = (modelMatrix * instanceTransform * vec4(previousCenter, 1.0)).xyz;
  vec3 worldNext = (modelMatrix * instanceTransform * vec4(nextCenter, 1.0)).xyz;
  vec3 tangent = normalize(worldNext - worldPrevious);
  vec3 viewDirection = normalize(cameraPosition - worldCenter.xyz);
  vec3 sideDirection = cross(viewDirection, tangent);

  if (dot(sideDirection, sideDirection) < 0.000001) {
    sideDirection = cross(vec3(0.0, 1.0, 0.0), tangent);
  }
  sideDirection = normalize(sideDirection);

  float taper = pow(1.0 - progress, uTaperPower);
  float width = mix(uTailWidth, uHeadWidth, taper) * trailStyle.y;
  float pulse = 0.82 + 0.18 * sin(trailCurve.w * 1.7 + trailStyle.z + progress * 17.0);
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
  float tailFade = 1.0 - smoothstep(0.68, 1.0, vProgress);
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

  const trailGeometry = createTrailRibbonGeometry();
  addTrailInstanceAttributes(trailGeometry, count);

  const trailMesh = new THREE.InstancedMesh(
    trailGeometry,
    createTrailMaterial(),
    count,
  );
  trailMesh.name = "NeonRibbonTrails";
  trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trailMesh.frustumCulled = false;
  trailMesh.renderOrder = 4;

  const headMesh = new THREE.InstancedMesh(
    createArrowConeGeometry(),
    createHeadMaterial(),
    count,
  );
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

  seedTrailInstanceAttributes(trailGeometry, count);

  return group;
}

export function disposeFishMesh(mesh) {
  if (!mesh) return;

  mesh.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      material?.dispose?.();
    }
  });
}

export function updateFishInstances(mesh, fish) {
  const trailMesh = mesh.userData.trailMesh;
  const headMesh = mesh.userData.headMesh;
  const headGlowMesh = mesh.userData.headGlowMesh;
  const trailCurve = trailMesh.geometry.getAttribute("trailCurve");
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

    trailMesh.setMatrixAt(i, tmpMatrix);
    headMesh.setMatrixAt(i, tmpMatrix);
    headGlowMesh.setMatrixAt(i, tmpMatrix);

    tmpCurveBend.set(0, 0, 0);
    if (currentFish.curveBendWorld?.lengthSq() > 0.000001) {
      tmpInverseQuaternion.copy(tmpQuaternion).invert();
      tmpCurveBend
        .copy(currentFish.curveBendWorld)
        .applyQuaternion(tmpInverseQuaternion);
      tmpCurveBend.y = 0;
    }

    trailCurve.setXYZW(
      i,
      THREE.MathUtils.clamp(
        tmpCurveBend.x,
        -fishConfig.ribbonCurveMax,
        fishConfig.ribbonCurveMax,
      ),
      THREE.MathUtils.clamp(
        tmpCurveBend.z,
        -fishConfig.ribbonCurveMax,
        fishConfig.ribbonCurveMax,
      ),
      THREE.MathUtils.clamp(currentFish.swimDrive ?? 0, 0, 1),
      currentFish.swimPhase ?? 0,
    );
  }

  trailMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  headGlowMesh.instanceMatrix.needsUpdate = true;
  trailCurve.needsUpdate = true;
}

function createTrailRibbonGeometry() {
  const segments = fishConfig.ribbonSegments;
  const positions = [];
  const progressValues = [];
  const sideValues = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i += 1) {
    const progress = i / segments;

    for (const side of [-1, 1]) {
      positions.push(0, -progress, 0);
      progressValues.push(progress);
      sideValues.push(side);
      uvs.push(side < 0 ? 0 : 1, progress);
    }
  }

  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "trailProgress",
    new THREE.Float32BufferAttribute(progressValues, 1),
  );
  geometry.setAttribute(
    "trailSide",
    new THREE.Float32BufferAttribute(sideValues, 1),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

function addTrailInstanceAttributes(geometry, count) {
  geometry.setAttribute(
    "trailStyle",
    new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4),
  );
  geometry.setAttribute(
    "trailCurve",
    new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4),
  );
  geometry.setAttribute(
    "trailColor",
    new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
  );
}

function seedTrailInstanceAttributes(geometry, count) {
  const trailStyle = geometry.getAttribute("trailStyle");
  const trailCurve = geometry.getAttribute("trailCurve");
  const trailColor = geometry.getAttribute("trailColor");

  for (let i = 0; i < count; i += 1) {
    const lengthScale = 0.74 + seeded01(i, 13.17) * 0.62;
    const widthScale = 0.72 + seeded01(i, 51.39) * 0.56;
    const phase = seeded01(i, 91.73) * Math.PI * 2;
    const spark = seeded01(i, 7.11);
    const colorBlend = seeded01(i, 29.47);

    trailStyle.setXYZW(i, lengthScale, widthScale, phase, spark);
    trailCurve.setXYZW(i, 0, 0, 0, phase);
    trailColor.setXYZ(
      i,
      THREE.MathUtils.lerp(0.1, 0.3, colorBlend),
      THREE.MathUtils.lerp(0.62, 1.08, spark),
      THREE.MathUtils.lerp(0.92, 1.46, 1 - colorBlend * 0.35),
    );
  }

  trailStyle.needsUpdate = true;
  trailCurve.needsUpdate = true;
  trailColor.needsUpdate = true;
}

function createTrailMaterial() {
  return new THREE.ShaderMaterial({
    name: "NeonRibbonTrailMaterial",
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTrailLength: { value: fishConfig.ribbonLength },
      uHeadWidth: { value: fishConfig.ribbonHeadWidth },
      uTailWidth: { value: fishConfig.ribbonTailWidth },
      uWaveAmplitude: { value: fishConfig.ribbonWaveAmplitude },
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

function createArrowConeGeometry({
  lengthScale = 1,
  radiusScale = 1,
  jitterScale = 1,
} = {}) {
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
    const tailProgress = THREE.MathUtils.clamp(
      -y / Math.max(0.0001, length),
      0,
      1,
    );
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
