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
const RENDER_FPS = 60;
const EXPORT_WIDTH = 2048;
const EXPORT_HEIGHT = 1152;
const EXPORT_ASPECT_RATIO = EXPORT_WIDTH / EXPORT_HEIGHT;
const EXPORT_RENDER_SCALES = new Set([1, 2]);
const DEFAULT_EXPORT_RENDER_SCALE = 1;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION_NEEDED = 10;
const crc32Table = createCrc32Table();
const MAX_TIMELINE_SECONDS = 14;
const SELECTED_RAY_HOLD_SECONDS = 0.35;
const CAMERA_REVEAL_BUFFER_SECONDS = 0.75;
const EXPORT_SETTLE_FRAMES = 2;
const AUTO_PAUSE_ON_FIRST_COLLISION_AVOIDANCE = true;
const COLLISION_DEBUG_RAY_REVEAL_GAP_SECONDS = 0.5;
const COLLISION_DEBUG_POINT_GROW_SECONDS = 0.07;
const COLLISION_DEBUG_RAY_DELAY_SECONDS = 0.04;
const COLLISION_DEBUG_RAY_STEP_SECONDS = 0.16;
const COLLISION_DEBUG_RAY_GROW_SECONDS = 0.13;
const DISPLAY_MODES = {
  1: {
    aquarium: true,
    uiPanels: true,
    worldAxes: true,
    sceneObjects: true,
  },
  2: {
    aquarium: true,
    uiPanels: false,
    worldAxes: false,
    sceneObjects: true,
  },
  3: {
    aquarium: false,
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
const previewShell = getRequiredElement("#preview-shell");
const canvas = getRequiredElement("#scene");
const renderer = createRenderer(canvas);
const scene = createScene();
const cameraRig = createCameraRig(renderer);
const query = new URLSearchParams(window.location.search);
const renderOptions = readRenderOptions(query);
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
  point: new THREE.Color(0xffffff),
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
const introCameraTarget = new THREE.Vector3(-4.3888, 0.8, 1.7316);
const introCameraView = {
  position: new THREE.Vector3(7.4135, 2.0878, 10.9675),
  target: introCameraTarget,
  speed: INTRO_CAMERA_SPEED,
};

let timelineStartCameraView = cameraViewPresets.z;
let timelineIntroCameraEnabled = true;
let fishMesh = null;
let simulationPaused = false;
let pendingSimulationSteps = 0;
let simulationTime = 0;
let playbackControls = null;
let renderControls = null;
let currentRenderFrame = 0;
let renderTimelineTotalFrames = 1;
let timelinePlaying = true;
let applyingAbsoluteFrame = false;
let collisionDebugLoggingEnabled = true;
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
applyRenderLayout();
applySimulationSettingsFromControls();
bindControls();
bindPlaybackControls();
bindRenderControls();
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
refreshRenderTimeline({ frame: 0, playing: true });
installSceneExportBridge();
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

  const togglePlayback = () => {
    setTimelinePlaying(!timelinePlaying);
  };

  toggleButton.addEventListener("click", togglePlayback);

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.key !== "Enter" || isEditingText(event.target)) {
      return;
    }

    event.preventDefault();
    togglePlayback();
  });

  stepButton.addEventListener("click", () => {
    if (timelinePlaying) return;

    setRenderFrame(currentRenderFrame + 1, { playing: false });
  });

  syncPlaybackControls();
}

function bindRenderControls() {
  const frameInput = getOptionalInput("#render-frame");
  const frameRange = getOptionalInput("#render-frame-range");
  const frameCount = getOptionalElement("#render-frame-count");
  const exportFrameButton = getOptionalElement("#export-frame");
  const exportSequenceButton = getOptionalElement("#export-sequence");
  const exportScaleSelect = getOptionalSelect("#export-scale");
  const exportStatus = getOptionalElement("#export-status");

  if (!frameInput || !frameRange || !frameCount) {
    return;
  }

  renderControls = {
    frameInput,
    frameRange,
    frameCount,
    exportFrameButton,
    exportSequenceButton,
    exportScaleSelect,
    exportStatus,
  };

  const handleFrameInput = (value) => {
    setRenderFrame(value, { playing: false });
  };

  frameInput.addEventListener("change", () => {
    handleFrameInput(readInputNumber(frameInput));
  });
  frameRange.addEventListener("input", () => {
    handleFrameInput(readInputNumber(frameRange));
  });
  exportFrameButton?.addEventListener("click", () => {
    void exportCurrentFrame();
  });
  exportSequenceButton?.addEventListener("click", () => {
    void exportSequence();
  });

  syncRenderControls();
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
  applyAquariumVisibility(mode.aquarium);
  applyUIPanelsVisibility(mode.uiPanels);
  applyWorldAxesVisibility(mode.worldAxes);
  applySceneObjectsVisibility(mode.sceneObjects);
}

function applyAquariumVisibility(visible) {
  aquariumEffects.group.visible = visible;
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

      timelineStartCameraView = preset;
      timelineIntroCameraEnabled = false;
      rig.setOrbitView(preset);
      setRenderFrame(currentRenderFrame, { playing: false });
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
  refreshRenderTimeline({ frame: 0, playing: timelinePlaying });
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
  toggleButton.textContent = timelinePlaying ? "Pause" : "Resume";
  toggleButton.setAttribute("aria-pressed", String(!timelinePlaying));
  stepButton.disabled = timelinePlaying;
}

function setSimulationPaused(paused, { syncControls = true } = {}) {
  simulationPaused = paused;
  if (!simulationPaused) {
    pendingSimulationSteps = 0;
    collisionAvoidanceSnapshot = null;
    collisionDebugRevealGapSeconds = 0;
    collisionDebugOverlay.reset();
  }
  if (syncControls) {
    syncPlaybackControls();
  }
}

function applyControlChange(key) {
  if (key === "count") {
    setFishCount(readControlValue(key));
    return;
  }

  if (key === "light") {
    lighting.setIntensity(readControlValue(key));
    renderCurrentFrame();
    return;
  }

  applySimulationSettingsFromControls();
  refreshRenderTimeline({ frame: 0, playing: timelinePlaying });
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
  refreshRenderTimeline({ frame: 0, playing: timelinePlaying });
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
  if (timelinePlaying) {
    const nextFrame = currentRenderFrame >= renderTimelineTotalFrames - 1
      ? 0
      : currentRenderFrame + 1;
    setRenderFrame(nextFrame, { playing: true });
  }
}

function stepTimelineFrame(frameDt, options = {}) {
  const simulationDt = maybePauseForFirstCollisionAvoidance(options)
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
        options,
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
}

function renderCurrentFrame() {
  renderAbsoluteFrame(currentRenderFrame);
}

function setTimelinePlaying(playing) {
  timelinePlaying = Boolean(playing);
  syncPlaybackControls();
  syncRenderControls();
}

function setRenderFrame(frame, { playing = timelinePlaying } = {}) {
  currentRenderFrame = clampFrame(frame, renderTimelineTotalFrames);
  timelinePlaying = Boolean(playing);
  renderCurrentFrame();
  syncPlaybackControls();
  syncRenderControls();
}

function renderAbsoluteFrame(frame, {
  exposeDebug = !renderOptions.isExportMode,
  logDebug = false,
  render = true,
} = {}) {
  const clampedFrame = clampFrame(frame, renderTimelineTotalFrames);
  const previousLoggingEnabled = collisionDebugLoggingEnabled;
  applyingAbsoluteFrame = true;
  collisionDebugLoggingEnabled = logDebug;

  try {
    resetTimelineState();
    for (let i = 0; i < clampedFrame; i += 1) {
      stepTimelineFrame(STEP_FRAME_SECONDS, {
        exposeDebug,
        logDebug,
      });
    }
    updateObstacleRay();
    cameraPanel.update();
    if (render) {
      renderer.render(scene, cameraRig.activeCamera);
    }
  } finally {
    collisionDebugLoggingEnabled = previousLoggingEnabled;
    applyingAbsoluteFrame = false;
  }
}

function resetTimelineState() {
  simulationTime = 0;
  pendingSimulationSteps = 0;
  didAutoPauseForCollisionAvoidance = false;
  collisionAvoidanceSnapshot = null;
  collisionDebugRevealGapSeconds = 0;
  simulationPaused = false;
  collisionDebugOverlay.reset();
  applySimulationSettingsFromControls();
  simulation.reset(readControlValue("count"));
  syncFishMeshWithSimulation();
  aquariumEffects.update(0);
  cameraRig.setOrbitView(timelineStartCameraView);
  if (timelineIntroCameraEnabled) {
    cameraRig.flyToOrbitView(introCameraView);
  }
  cameraRig.updateFishCamera(simulation.fish[fishConfig.highlightedIndex], 0);
  updateObstacleRay();
}

function syncFishMeshWithSimulation() {
  if (!fishMesh || fishMesh.count !== simulation.fish.length) {
    rebuildFishMesh();
    return;
  }

  updateFishInstances(fishMesh, simulation.fish);
}

function refreshRenderTimeline({ frame = currentRenderFrame, playing = timelinePlaying } = {}) {
  renderTimelineTotalFrames = computeRenderTimelineTotalFrames();
  currentRenderFrame = clampFrame(frame, renderTimelineTotalFrames);
  timelinePlaying = Boolean(playing);
  renderCurrentFrame();
  syncPlaybackControls();
  syncRenderControls();
}

function computeRenderTimelineTotalFrames() {
  const maxFrames = Math.ceil(MAX_TIMELINE_SECONDS * RENDER_FPS);
  const previousLoggingEnabled = collisionDebugLoggingEnabled;
  applyingAbsoluteFrame = true;
  collisionDebugLoggingEnabled = false;

  try {
    resetTimelineState();
    for (let frame = 0; frame < maxFrames; frame += 1) {
      stepTimelineFrame(STEP_FRAME_SECONDS, {
        exposeDebug: false,
        logDebug: false,
      });

      if (didAutoPauseForCollisionAvoidance && collisionAvoidanceSnapshot) {
        const selectedIndex = readSelectedCollisionCandidateIndex(collisionAvoidanceSnapshot);
        const revealSeconds =
          COLLISION_DEBUG_RAY_REVEAL_GAP_SECONDS
          + selectedIndex * COLLISION_DEBUG_RAY_STEP_SECONDS
          + COLLISION_DEBUG_RAY_DELAY_SECONDS
          + COLLISION_DEBUG_RAY_GROW_SECONDS
          + CAMERA_REVEAL_BUFFER_SECONDS
          + SELECTED_RAY_HOLD_SECONDS;
        return frame + Math.ceil(revealSeconds * RENDER_FPS) + 1;
      }
    }
  } finally {
    collisionDebugLoggingEnabled = previousLoggingEnabled;
    applyingAbsoluteFrame = false;
  }

  return maxFrames;
}

function readSelectedCollisionCandidateIndex(snapshot) {
  const selectedIndex = snapshot.visualSelectedIndex >= 0
    ? snapshot.visualSelectedIndex
    : snapshot.selectedIndex;
  return Math.max(0, selectedIndex);
}

function clampFrame(frame, totalFrames = renderTimelineTotalFrames) {
  const maxFrame = Math.max(0, totalFrames - 1);
  if (!Number.isFinite(frame)) {
    return 0;
  }

  return THREE.MathUtils.clamp(Math.round(frame), 0, maxFrame);
}

function maybePauseForFirstCollisionAvoidance(options = {}) {
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
    options,
  );
  didAutoPauseForCollisionAvoidance = true;
  pendingSimulationSteps = 0;
  collisionDebugRevealGapSeconds = COLLISION_DEBUG_RAY_REVEAL_GAP_SECONDS;
  setSimulationPaused(true, {
    syncControls: !applyingAbsoluteFrame,
  });
  return true;
}

function shouldRevealCollisionDebugRays(dt) {
  if (!simulationPaused || !collisionAvoidanceSnapshot) {
    collisionDebugRevealGapSeconds = 0;
    return false;
  }

  if (cameraRig.isOrbitViewTransitionActive) {
    collisionDebugRevealGapSeconds = COLLISION_DEBUG_RAY_REVEAL_GAP_SECONDS;
    return false;
  }

  if (collisionDebugRevealGapSeconds > 0) {
    collisionDebugRevealGapSeconds = Math.max(0, collisionDebugRevealGapSeconds - dt);
    return false;
  }

  return true;
}

function attachCollisionDebugVisualOrigin(snapshot, { exposeDebug = true, logDebug = true } = {}) {
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

  if (exposeDebug) {
    window.collisionAvoidanceSnapshot = snapshot;
  }
  if (logDebug) {
    logCollisionAvoidanceSnapshot(snapshot);
  }
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
  const pointGeometry = new THREE.SphereGeometry(0.075, 12, 8);
  const pointVertexColors = new Float32Array(
    pointGeometry.attributes.position.count * 3,
  ).fill(1);
  pointGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(pointVertexColors, 3),
  );
  const points = new THREE.InstancedMesh(
    pointGeometry,
    pointMaterial,
    maxRayCount,
  );
  for (let i = 0; i < maxRayCount; i += 1) {
    points.setColorAt(i, collisionDebugColors.point);
  }
  points.instanceColor.needsUpdate = true;
  points.count = 0;
  points.frustumCulled = false;
  points.renderOrder = 32;
  group.add(points);

  const matrix = new THREE.Matrix4();
  const pointScale = new THREE.Vector3();
  let activeSnapshot = null;
  let rayElapsedSeconds = 0;
  let loggedCandidateCount = 0;

  return {
    group,
    reset() {
      activeSnapshot = null;
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
        rayElapsedSeconds = 0;
        loggedCandidateCount = 0;
      }
      if (revealRays) {
        rayElapsedSeconds += dt;
      } else {
        rayElapsedSeconds = 0;
        loggedCandidateCount = 0;
      }

      group.visible = true;
      group.position.copy(snapshot.visualOrigin ?? snapshot.origin);

      const rayElapsed = revealRays ? rayElapsedSeconds : 0;
      const candidates = readVisibleCollisionCandidates(snapshot);
      let visibleCount = 0;

      for (let i = 0; i < candidates.length && i < maxRayCount; i += 1) {
        const candidate = candidates[i];
        const candidateElapsed = rayElapsed - i * COLLISION_DEBUG_RAY_STEP_SECONDS;
        if (candidateElapsed <= 0) {
          break;
        }
        if (collisionDebugLoggingEnabled && i >= loggedCandidateCount) {
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
        points.setColorAt(
          visibleCount,
          readCollisionCandidatePointColor(candidate),
        );
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

function readCollisionCandidatePointColor(candidate) {
  return readCollisionCandidateColor(candidate);
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
  const { width, height, pixelRatio } = readRenderSize();
  renderer.setPixelRatio(pixelRatio);
  cameraRig.resize(width, height);
  renderer.setSize(width, height, false);
  cameraPanel.update();
  renderCurrentFrame();
}

function readRenderSize() {
  if (renderOptions.isExportMode) {
    return {
      width: Math.round(EXPORT_WIDTH * renderOptions.renderScale),
      height: Math.round(EXPORT_HEIGHT * renderOptions.renderScale),
      pixelRatio: 1,
    };
  }

  return {
    width: Math.max(1, Math.round(canvas.clientWidth || window.innerWidth)),
    height: Math.max(1, Math.round(canvas.clientHeight || window.innerHeight)),
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  };
}

function applyRenderLayout() {
  if (!renderOptions.isExportMode) {
    return;
  }

  app.classList.add("app-export");
  app.dataset.uiPanels = "hidden";
  const width = Math.round(EXPORT_WIDTH * renderOptions.renderScale);
  const height = Math.round(EXPORT_HEIGHT * renderOptions.renderScale);
  previewShell.style.width = `${width}px`;
  previewShell.style.height = `${height}px`;
}

function readRenderOptions(params) {
  const exportMode = params.get("exportMode");
  const renderScale = Number(params.get("renderScale"));

  return {
    isExportMode: exportMode === "transparent" || exportMode === "composite-transparent",
    renderScale: Number.isFinite(renderScale)
      ? THREE.MathUtils.clamp(renderScale, 1, 16)
      : 1,
  };
}

function installSceneExportBridge() {
  window.__SCENE_3D_EXPORT__ = {
    getCurrentFrame: () => currentRenderFrame,
    getTotalFrames: () => renderTimelineTotalFrames,
    getSize: () => ({
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      aspectRatio: EXPORT_ASPECT_RATIO,
      fps: RENDER_FPS,
    }),
    setFrame: async (frame) => {
      const clampedFrame = clampFrame(frame, renderTimelineTotalFrames);
      currentRenderFrame = clampedFrame;
      timelinePlaying = false;
      renderAbsoluteFrame(clampedFrame, {
        exposeDebug: false,
        logDebug: false,
      });
      syncPlaybackControls();
      syncRenderControls();
      await waitForAnimationFrames(EXPORT_SETTLE_FRAMES);
      return clampedFrame;
    },
  };
}

function waitForAnimationFrames(frameCount = 1) {
  return new Promise((resolve) => {
    let remaining = Math.max(1, frameCount);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
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

function syncRenderControls() {
  if (!renderControls) return;

  const maxFrame = Math.max(0, renderTimelineTotalFrames - 1);
  renderControls.frameInput.max = String(maxFrame);
  renderControls.frameInput.value = String(currentRenderFrame);
  renderControls.frameRange.max = String(maxFrame);
  renderControls.frameRange.value = String(currentRenderFrame);
  renderControls.frameCount.value =
    `${currentRenderFrame + 1} / ${renderTimelineTotalFrames}`;
  const exportDisabled = renderOptions.isExportMode;
  if (renderControls.exportFrameButton) {
    renderControls.exportFrameButton.disabled = exportDisabled;
  }
  if (renderControls.exportSequenceButton) {
    renderControls.exportSequenceButton.disabled = exportDisabled;
  }
}

async function exportCurrentFrame() {
  if (!renderControls?.exportStatus) return;

  const status = renderControls.exportStatus;
  const renderScale = readExportRenderScale();
  const exportSize = readExportSize(renderScale);
  const filename = `boids-frame-${String(currentRenderFrame).padStart(4, "0")}.png`;
  setExportButtonsDisabled(true);
  status.textContent =
    `Exporting ${exportSize.width}x${exportSize.height} frame `
    + `${currentRenderFrame + 1}/${renderTimelineTotalFrames}...`;

  try {
    const blob = await renderFixedSizePngBlob({
      frame: currentRenderFrame,
      renderScale,
    });
    downloadBlob(blob, filename);
    status.textContent = `PNG exported at ${exportSize.width}x${exportSize.height}.`;
  } catch (error) {
    status.textContent = `Export failed: ${error.message}`;
  } finally {
    setExportButtonsDisabled(false);
  }
}

async function exportSequence() {
  if (!renderControls?.exportStatus) return;

  const status = renderControls.exportStatus;
  const renderScale = readExportRenderScale();
  const exportSize = readExportSize(renderScale);
  const startFrame = 0;
  const endFrame = renderTimelineTotalFrames - 1;
  const filename = `boids-frames-${String(renderTimelineTotalFrames).padStart(4, "0")}.zip`;
  setExportButtonsDisabled(true);
  status.textContent =
    `Exporting ${renderTimelineTotalFrames} frames at `
    + `${exportSize.width}x${exportSize.height}...`;

  try {
    const blob = await renderFixedSizeZipBlob({
      startFrame,
      endFrame,
      renderScale,
      onFrame: (frame) => {
        status.textContent =
          `Exporting ${exportSize.width}x${exportSize.height} frame `
          + `${frame + 1}/${renderTimelineTotalFrames}...`;
      },
    });
    downloadBlob(blob, filename);
    status.textContent = `ZIP exported at ${exportSize.width}x${exportSize.height}.`;
  } catch (error) {
    status.textContent = `Export failed: ${error.message}`;
  } finally {
    setExportButtonsDisabled(false);
  }
}

async function renderFixedSizePngBlob({ frame, renderScale }) {
  return withFixedSizeRenderer(renderScale, async () => {
    renderAbsoluteFrame(frame);
    return await canvasToBlob(canvas, "image/png");
  });
}

async function renderFixedSizeZipBlob({ startFrame, endFrame, renderScale, onFrame }) {
  return withFixedSizeRenderer(renderScale, async () => {
    const entries = [];

    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      onFrame?.(frame);
      renderAbsoluteFrame(frame);
      const blob = await canvasToBlob(canvas, "image/png");
      entries.push({
        name: formatFrameFileName(frame),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    return createStoredZipBlob(entries);
  });
}

async function withFixedSizeRenderer(renderScale, task) {
  const { width, height } = readExportSize(renderScale);
  const previousPixelRatio = renderer.getPixelRatio();
  const wasTimelinePlaying = timelinePlaying;

  timelinePlaying = false;
  syncPlaybackControls();

  renderer.setPixelRatio(1);
  cameraRig.resize(width, height);
  renderer.setSize(width, height, false);

  try {
    return await task();
  } finally {
    renderer.setPixelRatio(previousPixelRatio);
    resize();
    timelinePlaying = wasTimelinePlaying;
    syncPlaybackControls();
  }
}

function setExportButtonsDisabled(disabled) {
  if (!renderControls) return;
  if (renderControls.exportFrameButton) {
    renderControls.exportFrameButton.disabled = disabled || renderOptions.isExportMode;
  }
  if (renderControls.exportSequenceButton) {
    renderControls.exportSequenceButton.disabled = disabled || renderOptions.isExportMode;
  }
}

function readExportRenderScale() {
  const value = Number(renderControls?.exportScaleSelect?.value);
  return EXPORT_RENDER_SCALES.has(value) ? value : DEFAULT_EXPORT_RENDER_SCALE;
}

function readExportSize(renderScale) {
  return {
    width: Math.round(EXPORT_WIDTH * renderScale),
    height: Math.round(EXPORT_HEIGHT * renderScale),
  };
}

function formatFrameFileName(frame) {
  return `frame-${String(frame).padStart(4, "0")}.png`;
}

function createStoredZipBlob(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    if (entry.data.length > 0xffffffff) {
      throw new Error("A ZIP entry is too large for browser export.");
    }

    const nameBytes = encoder.encode(entry.name);
    const crc = computeCrc32(entry.data);
    const localHeader = createZipLocalHeader({ nameBytes, data: entry.data, crc });
    const centralHeader = createZipCentralHeader({
      nameBytes,
      data: entry.data,
      crc,
      localHeaderOffset: offset,
    });

    localParts.push(localHeader, entry.data);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
    centralSize += centralHeader.length;

    if (offset > 0xffffffff || centralSize > 0xffffffff) {
      throw new Error("ZIP is too large for browser export.");
    }
  }

  const centralOffset = offset;
  const endRecord = createZipEndRecord({
    entryCount: entries.length,
    centralSize,
    centralOffset,
  });

  return new Blob([...localParts, ...centralParts, endRecord], {
    type: "application/zip",
  });
}

function createZipLocalHeader({ nameBytes, data, crc }) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, ZIP_VERSION_NEEDED, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);
  return header;
}

function createZipCentralHeader({ nameBytes, data, crc, localHeaderOffset }) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, ZIP_VERSION_NEEDED, true);
  view.setUint16(6, ZIP_VERSION_NEEDED, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, data.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function createZipEndRecord({ entryCount, centralSize, centralOffset }) {
  if (entryCount > 0xffff) {
    throw new Error("ZIP has too many files.");
  }

  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return record;
}

function computeCrc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  return table;
}

function downloadBlob(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

function canvasToBlob(targetCanvas, type) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Canvas export failed."));
    }, type);
  });
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

function getOptionalElement(selector) {
  return document.querySelector(selector);
}

function getRequiredInput(selector) {
  const element = getRequiredElement(selector);

  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input element.`);
  }

  return element;
}

function getOptionalInput(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return null;
  }

  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input element.`);
  }

  return element;
}

function getOptionalSelect(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return null;
  }

  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Expected ${selector} to be a select element.`);
  }

  return element;
}
