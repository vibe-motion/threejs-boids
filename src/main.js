import * as THREE from "three";
import { FishSchoolSimulation } from "./fish-school-simulation.js";
import { bindCameraToggle, createCameraRig } from "./camera-rig.js";
import { aquariumHalfSize, fishConfig, obstacles, simulationSettings } from "./config.js";
import {
  createFishMesh,
  disposeFishMesh,
  getFishHeadPose,
  updateFishInstances,
} from "./fish-renderer.js";
import { createHeadingDebugger } from "./heading-debugger.js";
import {
  addLighting,
  addObstacles,
  addAquarium,
  addWorldAxes,
  createRenderer,
  createScene,
} from "./scene-setup.js";

const STEP_FRAME_SECONDS = 1 / 60;
const AUTO_PAUSE_ON_FIRST_COLLISION_AVOIDANCE = true;
const COLLISION_DEBUG_SPHERE_SECONDS = 0.62;
const COLLISION_DEBUG_POINT_GROW_SECONDS = 0.07;
const COLLISION_DEBUG_RAY_DELAY_SECONDS = 0.04;
const COLLISION_DEBUG_RAY_STEP_SECONDS = 0.16;
const COLLISION_DEBUG_RAY_GROW_SECONDS = 0.13;
const DISPLAY_MODES = {
  1: {
    uiPanels: true,
    worldAxes: true,
    sceneObjects: true,
  },
  2: {
    uiPanels: false,
    worldAxes: false,
    sceneObjects: true,
  },
};
const DEFAULT_DISPLAY_MODE = "2";
const textInputTypes = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);
const app = getRequiredElement("#app");
const canvas = getRequiredElement("#scene");
const renderer = createRenderer(canvas);
const scene = createScene();
const clock = new THREE.Clock();
const cameraRig = createCameraRig(renderer);
const query = new URLSearchParams(window.location.search);
const headingDebugger = createHeadingDebugger({
  enabled: query.get("debugHeading") === "1",
  frameLimit: Number(query.get("debugFrames")) || undefined,
});
const simulation = new FishSchoolSimulation({
  aquariumHalfSize,
  obstacles,
  settings: simulationSettings,
});

const controls = {
  count: createControl("#count", "#count-value"),
  perception: createControl("#perception", "#perception-value"),
  separation: createControl("#separation", "#separation-value"),
  avoidance: createControl("#avoidance", "#avoidance-value"),
  turnRate: createControl("#turn-rate", "#turn-rate-value"),
  light: createControl("#light", "#light-value"),
};

const simulationControlSettings = {
  perception: "perceptionRadius",
  separation: "separateWeight",
  avoidance: "avoidCollisionWeight",
  turnRate: "maxTurnRate",
};
const obstacleMoveStep = 0.32;
const obstacleMoveKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const obstacleRayColors = {
  clear: new THREE.Color(0x27e86f),
  hit: new THREE.Color(0xff3636),
};
const collisionDebugColors = {
  sphere: new THREE.Color(0x47c7ff),
  blocked: new THREE.Color(0xff4f4f),
  wall: new THREE.Color(0xffa640),
  selected: new THREE.Color(0x3cff84),
};
const cameraViewTarget = new THREE.Vector3(0, 0.8, 0);
const cameraViewPresets = {
  x: {
    position: new THREE.Vector3(21.3715, 1.4141, 1.4742),
    target: cameraViewTarget,
  },
  y: {
    position: new THREE.Vector3(0, 22, 0),
    target: cameraViewTarget,
    up: new THREE.Vector3(0, 0, -1),
  },
  z: {
    position: new THREE.Vector3(8.8912, 2.2841, 15.9146),
    target: cameraViewTarget,
  },
  default: {
    position: new THREE.Vector3(0, 8.5, 20),
    target: cameraViewTarget,
  },
};
const INTRO_CAMERA_SPEED = 4.2;
const COLLISION_DEBUG_AFTER_CAMERA_GAP_SECONDS = 0.28;
const introCameraTarget = new THREE.Vector3(-4.3888, 0.8, 1.7316);
const introCameraView = {
  position: new THREE.Vector3(7.4135, 2.0878, 10.9675),
  target: introCameraTarget,
  speed: INTRO_CAMERA_SPEED,
};

let fishMesh = null;
let simulationPaused = false;
let pendingSimulationSteps = 0;
let simulationTime = 0;
let playbackControls = null;
let didAutoPauseForCollisionAvoidance = false;
let collisionAvoidanceSnapshot = null;
let collisionDebugRevealGapSeconds = 0;
const obstacleRay = createObstacleRay();
const obstacleRayPose = {
  position: new THREE.Vector3(),
  direction: new THREE.Vector3(),
};
const obstacleRayEnd = new THREE.Vector3();
const collisionProbeDirection = new THREE.Vector3();
const collisionDebugOverlay = createCollisionAvoidanceDebugOverlay(
  simulation.rayDirections.length,
);

const lighting = addLighting(scene);
lighting.setIntensity(readControlValue("light"));
const aquariumEffects = addAquarium(scene);
const worldAxes = addWorldAxes(scene);
scene.add(obstacleRay);
scene.add(collisionDebugOverlay.group);
const obstacleMeshes = addObstacles(scene, obstacles);
applySimulationSettingsFromControls();
bindControls();
bindPlaybackControls();
bindDisplayModeControls();
bindCameraToggle(cameraRig);
bindObstacleKeyboardControls(obstacleMeshes);
bindCameraViewControls(cameraRig);
applyDisplayMode(DEFAULT_DISPLAY_MODE);
cameraRig.setOrbitView(cameraViewPresets.z);
cameraRig.flyToOrbitView(introCameraView);
const cameraPanel = bindCameraPanel(cameraRig);
simulation.reset(readControlValue("count"));
rebuildFishMesh();
resize();
window.addEventListener("resize", resize);
renderer.setAnimationLoop(animate);

function bindControls() {
  for (const [key, control] of Object.entries(controls)) {
    syncControlOutput(control);
    control.input.addEventListener("input", () => {
      syncControlOutput(control);
      applyControlChange(key);
    });
  }
}

function bindPlaybackControls() {
  const toggleButton = getRequiredElement("#playback-toggle");
  const stepButton = getRequiredElement("#step-frame");
  playbackControls = { toggleButton, stepButton };

  toggleButton.addEventListener("click", () => {
    setSimulationPaused(!simulationPaused);
  });

  stepButton.addEventListener("click", () => {
    if (!simulationPaused) return;

    pendingSimulationSteps += 1;
  });

  syncPlaybackControls();
}

function bindDisplayModeControls() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isEditingText(event.target)) {
      return;
    }

    const modeKey = readDisplayModeKey(event);
    if (!modeKey || !DISPLAY_MODES[modeKey]) {
      return;
    }

    event.preventDefault();
    applyDisplayMode(modeKey);
  });
}

function readDisplayModeKey(event) {
  if (/^[1-9]$/.test(event.key)) {
    return event.key;
  }

  const digitMatch = event.code.match(/^(?:Digit|Numpad)([1-9])$/);
  return digitMatch?.[1] ?? null;
}

function applyDisplayMode(modeKey) {
  const mode = DISPLAY_MODES[modeKey];
  if (!mode) return;

  app.dataset.displayMode = modeKey;
  applyUIPanelsVisibility(mode.uiPanels);
  applyWorldAxesVisibility(mode.worldAxes);
  applySceneObjectsVisibility(mode.sceneObjects);
}

function applyUIPanelsVisibility(visible) {
  app.dataset.uiPanels = visible ? "visible" : "hidden";
}

function applySceneObjectsVisibility(visible) {
  scene.visible = visible;
}

function applyWorldAxesVisibility(visible) {
  worldAxes.visible = visible;
}

function bindObstacleKeyboardControls(obstacleMeshes) {
  const controlled = obstacleMeshes.find(
    ({ obstacle }) => obstacle.shape === "plate",
  );
  if (!controlled) return;

  window.addEventListener("keydown", (event) => {
    if (!isObstacleMoveKey(event.code) || isEditingText(event.target)) {
      return;
    }

    event.preventDefault();
    moveObstacle(controlled, event.code);
  });
}

function bindCameraViewControls(rig) {
  for (const button of document.querySelectorAll("[data-camera-view]")) {
    button.addEventListener("click", () => {
      const preset = cameraViewPresets[button.dataset.cameraView];
      if (!preset) return;

      rig.setOrbitView(preset);
    });
  }
}

function isObstacleMoveKey(code) {
  return obstacleMoveKeys.has(code);
}

function moveObstacle({ obstacle, mesh }, code) {
  const halfSize = obstacle.size?.clone().multiplyScalar(0.5) ?? new THREE.Vector3();
  const yLimit = aquariumHalfSize.y - halfSize.y;
  const zLimit = aquariumHalfSize.z - halfSize.z;

  // WASD is defined from the +X aquarium side looking straight at the plate.
  if (code === "KeyW") {
    obstacle.position.y = Math.min(yLimit, obstacle.position.y + obstacleMoveStep);
  } else if (code === "KeyS") {
    obstacle.position.y = Math.max(-yLimit, obstacle.position.y - obstacleMoveStep);
  } else if (code === "KeyA") {
    obstacle.position.z = Math.min(zLimit, obstacle.position.z + obstacleMoveStep);
  } else if (code === "KeyD") {
    obstacle.position.z = Math.max(-zLimit, obstacle.position.z - obstacleMoveStep);
  }

  mesh.position.copy(obstacle.position);
}

function isEditingText(target) {
  return (
    (target instanceof HTMLInputElement && textInputTypes.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function syncPlaybackControls() {
  if (!playbackControls) return;

  const { toggleButton, stepButton } = playbackControls;
  toggleButton.textContent = simulationPaused ? "Resume" : "Pause";
  toggleButton.setAttribute("aria-pressed", String(simulationPaused));
  stepButton.disabled = !simulationPaused;
}

function setSimulationPaused(paused) {
  simulationPaused = paused;
  if (!simulationPaused) {
    pendingSimulationSteps = 0;
    collisionAvoidanceSnapshot = null;
    collisionDebugRevealGapSeconds = 0;
    collisionDebugOverlay.reset();
  }
  syncPlaybackControls();
}

function applyControlChange(key) {
  if (key === "count") {
    setFishCount(readControlValue(key));
    return;
  }

  if (key === "light") {
    lighting.setIntensity(readControlValue(key));
    return;
  }

  applySimulationSettingsFromControls();
}

function applySimulationSettingsFromControls() {
  for (const [key, settingName] of Object.entries(simulationControlSettings)) {
    simulationSettings[settingName] = readControlValue(key);
  }
}

function setFishCount(count) {
  simulation.setCount(count);
  didAutoPauseForCollisionAvoidance = false;
  collisionAvoidanceSnapshot = null;
  collisionDebugOverlay.reset();
  rebuildFishMesh();
}

function rebuildFishMesh() {
  if (fishMesh) {
    scene.remove(fishMesh);
    disposeFishMesh(fishMesh);
  }

  fishMesh = createFishMesh(simulation.fish.length);
  scene.add(fishMesh);
  updateFishInstances(fishMesh, simulation.fish);
  cameraRig.updateFishCamera(simulation.fish[fishConfig.highlightedIndex]);
}

function animate() {
  const frameDt = Math.min(clock.getDelta(), 1 / 30);
  const simulationDt = maybePauseForFirstCollisionAvoidance()
    ? 0
    : getSimulationDelta(frameDt);
  let trace = null;

  if (simulationDt > 0) {
    simulationTime += simulationDt;
    trace = simulation.update(simulationDt, {
      traceIndex: headingDebugger?.traceIndex ?? fishConfig.highlightedIndex,
    });
    if (trace?.collisionAvoidanceSnapshot) {
      collisionAvoidanceSnapshot = attachCollisionDebugVisualOrigin(
        trace.collisionAvoidanceSnapshot,
      );
    }
    updateFishInstances(fishMesh, simulation.fish);
    aquariumEffects.update(simulationTime);
    headingDebugger?.sample({
      dt: simulationDt,
      fish: simulation.fish[fishConfig.highlightedIndex],
      trace,
    });
    cameraRig.updateFishCamera(
      simulation.fish[fishConfig.highlightedIndex],
      simulationDt,
    );
  }

  updateObstacleRay();
  cameraRig.update(frameDt);
  const collisionDebugSnapshot = simulationPaused ? collisionAvoidanceSnapshot : null;
  collisionDebugOverlay.update(
    collisionDebugSnapshot,
    frameDt,
    shouldRevealCollisionDebugRays(frameDt),
  );
  cameraPanel.update();
  renderer.render(scene, cameraRig.activeCamera);
}

function maybePauseForFirstCollisionAvoidance() {
  if (!AUTO_PAUSE_ON_FIRST_COLLISION_AVOIDANCE || didAutoPauseForCollisionAvoidance) {
    return false;
  }

  const fish = simulation.fish[fishConfig.highlightedIndex];
  if (!fish) {
    return false;
  }

  collisionProbeDirection.copy(fish.velocity).normalize();
  if (!simulation.isHeadingForCollision(fish.position, collisionProbeDirection)) {
    return false;
  }

  collisionAvoidanceSnapshot = attachCollisionDebugVisualOrigin(
    simulation.createCollisionAvoidanceSnapshot(
      fish.position,
      collisionProbeDirection,
    ),
  );
  didAutoPauseForCollisionAvoidance = true;
  pendingSimulationSteps = 0;
  collisionDebugRevealGapSeconds = COLLISION_DEBUG_AFTER_CAMERA_GAP_SECONDS;
  setSimulationPaused(true);
  return true;
}

function shouldRevealCollisionDebugRays(dt) {
  if (!simulationPaused || !collisionAvoidanceSnapshot) {
    collisionDebugRevealGapSeconds = 0;
    return false;
  }

  if (cameraRig.isOrbitViewTransitionActive) {
    collisionDebugRevealGapSeconds = COLLISION_DEBUG_AFTER_CAMERA_GAP_SECONDS;
    return false;
  }

  if (collisionDebugRevealGapSeconds > 0) {
    collisionDebugRevealGapSeconds = Math.max(0, collisionDebugRevealGapSeconds - dt);
    return false;
  }

  return true;
}

function attachCollisionDebugVisualOrigin(snapshot) {
  snapshot.visualOrigin = snapshot.origin
    .clone()
    .addScaledVector(snapshot.forward, fishConfig.length / 2);
  snapshot.visualSelectedIndex = -1;

  for (const candidate of snapshot.candidateRays) {
    const obstacleDistance = simulation.rayObstacleHitDistance(
      snapshot.visualOrigin,
      candidate.direction,
      Infinity,
    );
    const visualEnd = snapshot.visualOrigin.clone().addScaledVector(
      candidate.direction,
      snapshot.maxDistance,
    );

    candidate.visualObstacleDistance = Number.isFinite(obstacleDistance)
      ? obstacleDistance
      : null;
    candidate.visualHitsObstacle = obstacleDistance <= snapshot.maxDistance;
    candidate.visualHitsWall = !simulation.isInsideAquarium(
      visualEnd,
      simulationSettings.boundsRadius,
    );
    candidate.visualIsClear = !candidate.visualHitsObstacle && !candidate.visualHitsWall;
    candidate.visualIsSelected =
      candidate.visualIsClear && snapshot.visualSelectedIndex === -1;

    if (candidate.visualIsSelected) {
      snapshot.visualSelectedIndex = candidate.index;
      snapshot.visualSelectedDirection = candidate.direction.clone();
    }
  }

  window.collisionAvoidanceSnapshot = snapshot;
  logCollisionAvoidanceSnapshot(snapshot);
  return snapshot;
}

function createObstacleRay() {
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: obstacleRayColors.clear,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 20;
  return line;
}

function createCollisionAvoidanceDebugOverlay(maxRayCount) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 30;

  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: collisionDebugColors.sphere,
    transparent: true,
    opacity: 0,
    wireframe: true,
    depthTest: false,
  });
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    sphereMaterial,
  );
  sphere.renderOrder = 30;
  group.add(sphere);

  const rayPositions = new Float32Array(maxRayCount * 2 * 3);
  const rayColors = new Float32Array(maxRayCount * 2 * 3);
  const rayGeometry = new THREE.BufferGeometry();
  rayGeometry.setAttribute("position", new THREE.BufferAttribute(rayPositions, 3));
  rayGeometry.setAttribute("color", new THREE.BufferAttribute(rayColors, 3));
  rayGeometry.setDrawRange(0, 0);
  const rayMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
  });
  const rays = new THREE.LineSegments(rayGeometry, rayMaterial);
  rays.frustumCulled = false;
  rays.renderOrder = 31;
  group.add(rays);

  const pointMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
  });
  const points = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.075, 12, 8),
    pointMaterial,
    maxRayCount,
  );
  points.count = 0;
  points.frustumCulled = false;
  points.renderOrder = 32;
  group.add(points);

  const matrix = new THREE.Matrix4();
  const pointScale = new THREE.Vector3();
  let activeSnapshot = null;
  let elapsedSeconds = 0;
  let rayElapsedSeconds = 0;
  let loggedCandidateCount = 0;

  return {
    group,
    reset() {
      activeSnapshot = null;
      elapsedSeconds = 0;
      rayElapsedSeconds = 0;
      loggedCandidateCount = 0;
      group.visible = false;
      rayGeometry.setDrawRange(0, 0);
      points.count = 0;
    },
    update(snapshot, dt, revealRays = true) {
      if (!snapshot) {
        this.reset();
        return;
      }

      if (snapshot !== activeSnapshot) {
        activeSnapshot = snapshot;
        elapsedSeconds = 0;
        rayElapsedSeconds = 0;
        loggedCandidateCount = 0;
      } else {
        elapsedSeconds += dt;
      }
      if (revealRays) {
        rayElapsedSeconds += dt;
      } else {
        rayElapsedSeconds = 0;
        loggedCandidateCount = 0;
      }

      group.visible = true;
      group.position.copy(snapshot.visualOrigin ?? snapshot.origin);

      const sphereProgress = easeOutCubic(
        clamp01(elapsedSeconds / COLLISION_DEBUG_SPHERE_SECONDS),
      );
      sphere.scale.setScalar(snapshot.maxDistance * sphereProgress);
      sphereMaterial.opacity = 0.18 * sphereProgress;

      const rayElapsed = revealRays ? rayElapsedSeconds : 0;
      const candidates = readVisibleCollisionCandidates(snapshot);
      let visibleCount = 0;

      for (let i = 0; i < candidates.length && i < maxRayCount; i += 1) {
        const candidate = candidates[i];
        const candidateElapsed = rayElapsed - i * COLLISION_DEBUG_RAY_STEP_SECONDS;
        if (candidateElapsed <= 0) {
          break;
        }
        if (i >= loggedCandidateCount) {
          logCollisionCandidate(snapshot, candidate, i);
        }

        const pointProgress = easeOutBack(
          clamp01(candidateElapsed / COLLISION_DEBUG_POINT_GROW_SECONDS),
        );
        const rayProgress = easeOutCubic(
          clamp01(
            (candidateElapsed - COLLISION_DEBUG_RAY_DELAY_SECONDS)
              / COLLISION_DEBUG_RAY_GROW_SECONDS,
          ),
        );

        const color = readCollisionCandidateColor(candidate);
        const end = candidate.direction
          .clone()
          .multiplyScalar(snapshot.maxDistance * rayProgress);
        writeLineSegment(rayPositions, visibleCount, end);
        writeLineColor(rayColors, visibleCount, color);
        writePointInstance(
          points,
          matrix,
          pointScale,
          visibleCount,
          candidate,
          snapshot.maxDistance,
          pointProgress,
        );
        points.setColorAt(visibleCount, color);
        visibleCount += 1;
      }
      loggedCandidateCount = Math.max(loggedCandidateCount, visibleCount);

      rayGeometry.setDrawRange(0, visibleCount * 2);
      rayGeometry.attributes.position.needsUpdate = true;
      rayGeometry.attributes.color.needsUpdate = true;
      points.count = visibleCount;
      points.instanceMatrix.needsUpdate = true;
      if (points.instanceColor) {
        points.instanceColor.needsUpdate = true;
      }
    },
  };
}

function readVisibleCollisionCandidates(snapshot) {
  const selectedIndex = snapshot.visualSelectedIndex >= 0
    ? snapshot.visualSelectedIndex
    : snapshot.selectedIndex;
  const endIndex = selectedIndex >= 0
    ? selectedIndex
    : snapshot.candidateRays.length - 1;
  return snapshot.candidateRays.slice(0, endIndex + 1);
}

function writeLineSegment(positions, segmentIndex, end) {
  const offset = segmentIndex * 6;
  positions[offset] = 0;
  positions[offset + 1] = 0;
  positions[offset + 2] = 0;
  positions[offset + 3] = end.x;
  positions[offset + 4] = end.y;
  positions[offset + 5] = end.z;
}

function writeLineColor(colors, segmentIndex, color) {
  const offset = segmentIndex * 6;
  colors[offset] = color.r;
  colors[offset + 1] = color.g;
  colors[offset + 2] = color.b;
  colors[offset + 3] = color.r;
  colors[offset + 4] = color.g;
  colors[offset + 5] = color.b;
}

function writePointInstance(points, matrix, scale, index, candidate, radius, progress) {
  const position = candidate.direction.clone().multiplyScalar(radius);
  scale.setScalar(progress);
  matrix.compose(position, points.quaternion, scale);
  points.setMatrixAt(index, matrix);
}

function readCollisionCandidateColor(candidate) {
  if (candidate.visualIsSelected) {
    return collisionDebugColors.selected;
  }
  if (candidate.visualIsSelected === undefined && candidate.isSelected) {
    return collisionDebugColors.selected;
  }

  const hitsWall = candidate.visualHitsWall ?? candidate.hitsWall;
  return hitsWall
    ? collisionDebugColors.wall
    : collisionDebugColors.blocked;
}

function logCollisionAvoidanceSnapshot(snapshot) {
  console.groupCollapsed("[collision-debug] pause snapshot");
  console.table({
    centerOrigin: vectorToDebugString(snapshot.origin),
    visualOrigin: vectorToDebugString(snapshot.visualOrigin),
    forward: vectorToDebugString(snapshot.forward),
    maxDistance: snapshot.maxDistance,
    algorithmSelectedIndex: snapshot.selectedIndex,
    visualSelectedIndex: snapshot.visualSelectedIndex,
  });
  console.groupEnd();
}

function logCollisionCandidate(snapshot, candidate, visibleOrder) {
  console.table({
    visibleOrder,
    candidateIndex: candidate.index,
    algorithmHitsObstacle: candidate.hitsObstacle,
    algorithmObstacleDistance: formatDebugDistance(candidate.obstacleDistance),
    algorithmHitsWall: candidate.hitsWall,
    algorithmSelected: candidate.isSelected,
    visualHitsObstacle: candidate.visualHitsObstacle,
    visualObstacleDistance: formatDebugDistance(candidate.visualObstacleDistance),
    visualHitsWall: candidate.visualHitsWall,
    visualSelected: candidate.visualIsSelected,
    maxDistance: snapshot.maxDistance,
    direction: vectorToDebugString(candidate.direction),
  });
}

function vectorToDebugString(vector) {
  return [
    vector.x.toFixed(3),
    vector.y.toFixed(3),
    vector.z.toFixed(3),
  ].join(", ");
}

function formatDebugDistance(distance) {
  return distance === null ? "no hit" : Number(distance.toFixed(3));
}

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function updateObstacleRay() {
  const fish = simulation.fish[fishConfig.highlightedIndex];
  if (!fish) {
    obstacleRay.visible = false;
    return;
  }

  obstacleRay.visible = true;
  getFishHeadPose(fish, obstacleRayPose);
  const rayDistance = simulationSettings.collisionAvoidDistance;
  obstacleRayEnd.copy(obstacleRayPose.position).addScaledVector(
    obstacleRayPose.direction,
    rayDistance,
  );

  const positionAttribute = obstacleRay.geometry.attributes.position;
  positionAttribute.setXYZ(
    0,
    obstacleRayPose.position.x,
    obstacleRayPose.position.y,
    obstacleRayPose.position.z,
  );
  positionAttribute.setXYZ(
    1,
    obstacleRayEnd.x,
    obstacleRayEnd.y,
    obstacleRayEnd.z,
  );
  positionAttribute.needsUpdate = true;

  const hitsObstacle = simulation.rayHitsObstacle(
    obstacleRayPose.position,
    obstacleRayPose.direction,
    rayDistance,
  );
  const hitsWall = !simulation.isInsideAquarium(
    obstacleRayEnd,
    simulationSettings.boundsRadius,
  );

  obstacleRay.material.color.copy(
    hitsObstacle || hitsWall ? obstacleRayColors.hit : obstacleRayColors.clear,
  );
}

function getSimulationDelta(frameDt) {
  if (!simulationPaused) {
    return frameDt;
  }

  if (pendingSimulationSteps <= 0) {
    return 0;
  }

  pendingSimulationSteps -= 1;
  return STEP_FRAME_SECONDS;
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  cameraRig.resize(width, height);
  renderer.setSize(width, height, false);
  cameraPanel.update();
}

function bindCameraPanel(rig) {
  const copyButton = getRequiredElement("#copy-camera-json");
  const copyStatus = getRequiredElement("#copy-camera-status");
  let copyStatusTimeout = 0;

  copyButton.addEventListener("click", async () => {
    const json = JSON.stringify(readCameraTransformSnapshot(rig), null, 2);
    const copied = await copyText(json);
    copyStatus.textContent = copied ? "Copied camera JSON" : "Copy failed";
    window.clearTimeout(copyStatusTimeout);
    copyStatusTimeout = window.setTimeout(() => {
      copyStatus.textContent = "";
    }, 1800);
  });

  return { update() {} };
}

function readCameraTransformSnapshot(rig) {
  const camera = rig.activeCamera;

  return {
    mode: rig.mode,
    transform: {
      position: vectorToJSON(camera.position),
      rotation: {
        x: roundCameraNumber(camera.rotation.x),
        y: roundCameraNumber(camera.rotation.y),
        z: roundCameraNumber(camera.rotation.z),
        order: camera.rotation.order,
      },
      quaternion: {
        x: roundCameraNumber(camera.quaternion.x),
        y: roundCameraNumber(camera.quaternion.y),
        z: roundCameraNumber(camera.quaternion.z),
        w: roundCameraNumber(camera.quaternion.w),
      },
      up: vectorToJSON(camera.up),
    },
  };
}

async function copyText(text) {
  if (!navigator.clipboard?.writeText) {
    return fallbackCopyText(text);
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-999px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function vectorToJSON(vector) {
  return {
    x: roundCameraNumber(vector.x),
    y: roundCameraNumber(vector.y),
    z: roundCameraNumber(vector.z),
  };
}

function roundCameraNumber(value) {
  return Number(value.toFixed(4));
}

function createControl(inputSelector, outputSelector) {
  return {
    input: getRequiredInput(inputSelector),
    output: getRequiredElement(outputSelector),
  };
}

function syncControlOutput({ input, output }) {
  output.value = input.value;
}

function readControlValue(key) {
  return readInputNumber(controls[key].input);
}

function readInputNumber(input) {
  if (Number.isFinite(input.valueAsNumber)) {
    return input.valueAsNumber;
  }

  const defaultValue = Number(input.defaultValue);
  return Number.isFinite(defaultValue) ? defaultValue : 0;
}

function getRequiredElement(selector) {
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function getRequiredInput(selector) {
  const element = getRequiredElement(selector);

  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input element.`);
  }

  return element;
}
