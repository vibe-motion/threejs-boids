import * as THREE from "three";
import { FishSchoolSimulation } from "./fish-school-simulation.js";
import { createCameraRig } from "./camera-rig.js";
import {
  fishConfig,
  schoolSpawnHalfSize,
  simulationSettings,
} from "./config.js";
import {
  createFishMesh,
  disposeFishMesh,
  updateFishInstances,
} from "./fish-renderer.js";
import { createHeadingDebugger } from "./heading-debugger.js";
import {
  addLighting,
  createRenderer,
  createScene,
} from "./scene-setup.js";

const RENDER_FPS = 30;
const STEP_FRAME_SECONDS = 1 / RENDER_FPS;
const EXPORT_WIDTH = 2048;
const EXPORT_HEIGHT = 1152;
const EXPORT_ASPECT_RATIO = EXPORT_WIDTH / EXPORT_HEIGHT;
const DEFAULT_EXPORT_RENDER_SCALE = 2;
const EXPORT_SETTLE_FRAMES = 2;
const MAX_TIMELINE_FRAMES = 600;
const DEFAULT_LIGHT_INTENSITY = 1.3;
const INTERACTIVE_MAX_DELTA_SECONDS = 1 / 20;
const DEFAULT_DISPLAY_MODE = "1";
const CLICK_ADD_FISH_MAX_POINTER_DISTANCE = 6;

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
const query = new URLSearchParams(window.location.search);
const renderOptions = readRenderOptions(query);
const renderer = createRenderer(canvas);
const scene = createScene({
  transparentBackground: renderOptions.transparentBackground,
});
const cameraRig = createCameraRig(renderer);
const headingDebugger = createHeadingDebugger({
  enabled: query.get("debugHeading") === "1",
  frameLimit: Number(query.get("debugFrames")) || undefined,
});
const simulation = new FishSchoolSimulation({
  spawnHalfSize: schoolSpawnHalfSize,
  settings: simulationSettings,
});

const controls = {
  separation: createControl("#separation", "#separation-value"),
  alignment: createControl("#alignment", "#alignment-value"),
  cohesion: createControl("#cohesion", "#cohesion-value"),
  centering: createControl("#centering", "#centering-value"),
  swirl: createControl("#swirl", "#swirl-value"),
  count: createControl("#count", "#count-value"),
  turnRate: createControl("#turn-rate", "#turn-rate-value"),
};

const simulationControlSettings = {
  separation: "separateWeight",
  alignment: "alignWeight",
  cohesion: "cohesionWeight",
  centering: "centeringWeight",
  swirl: "toroidalFlowWeight",
  turnRate: "maxTurnRate",
};

const cameraViewTarget = new THREE.Vector3(0, 0.3, 0);
const cameraViewPresets = {
  x: {
    position: new THREE.Vector3(19, 2.4, 0),
    target: cameraViewTarget,
  },
  y: {
    position: new THREE.Vector3(0, 21, 0),
    target: cameraViewTarget,
    up: new THREE.Vector3(0, 0, -1),
  },
  z: {
    position: new THREE.Vector3(0, 2.8, 19),
    target: cameraViewTarget,
  },
  default: {
    position: new THREE.Vector3(8.8, 4.8, 18),
    target: cameraViewTarget,
  },
};

let fishMesh = null;
let simulationTime = 0;
let playbackControls = null;
let currentRenderFrame = 0;
let renderTimelineTotalFrames = MAX_TIMELINE_FRAMES;
let timelinePlaying = true;
let interactivePlaybackTimestamp = null;
let cameraPanel = null;

const lighting = addLighting(scene);
lighting.setIntensity(DEFAULT_LIGHT_INTENSITY);

applyRenderLayout();
applySimulationSettingsFromControls();
bindControls();
bindPlaybackControls();
bindDisplayModeControls();
bindCameraViewControls(cameraRig);
bindCanvasFishClickControls();
cameraRig.setOrbitView(cameraViewPresets.default);
cameraRig.setFreeCameraEnabled(true);
cameraPanel = bindCameraPanel(cameraRig);
simulation.reset(readControlValue("count"));
rebuildFishMesh();
resize();
installSceneExportBridge();
window.addEventListener("resize", resize);
renderer.setAnimationLoop(animate);
applyDisplayMode(DEFAULT_DISPLAY_MODE);

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

    stepSimulation(STEP_FRAME_SECONDS);
    renderScene(STEP_FRAME_SECONDS);
  });

  syncPlaybackControls();
}

function bindDisplayModeControls() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isEditingText(event.target)) {
      return;
    }

    if (event.key === "1") {
      event.preventDefault();
      applyDisplayMode("1");
    } else if (event.key === "2") {
      event.preventDefault();
      applyDisplayMode("2");
    }
  });
}

function applyDisplayMode(modeKey) {
  app.dataset.displayMode = modeKey;
  app.dataset.uiPanels = modeKey === "2" ? "hidden" : "visible";
}

function bindCameraViewControls(rig) {
  for (const button of document.querySelectorAll("[data-camera-view]")) {
    button.addEventListener("click", () => {
      const preset = cameraViewPresets[button.dataset.cameraView];
      if (!preset) return;

      rig.setFreeCameraView(preset);
      renderCurrentFrame();
      cameraPanel?.update();
    });
  }
}

function bindCanvasFishClickControls() {
  let pointerDown = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isEditingText(event.target)) {
      pointerDown = null;
      return;
    }

    pointerDown = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown || event.pointerId !== pointerDown.pointerId) {
      pointerDown = null;
      return;
    }

    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;

    if (distance > CLICK_ADD_FISH_MAX_POINTER_DISTANCE) {
      return;
    }

    incrementFishCount();
  });

  canvas.addEventListener("pointercancel", () => {
    pointerDown = null;
  });
}

function applyControlChange(key) {
  if (key === "count") {
    setFishCount(readControlValue(key));
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
  rebuildFishMesh();
  renderCurrentFrame();
}

function incrementFishCount() {
  setCountControlValue(simulation.fish.length + 1);
  setFishCount(readControlValue("count"));
}

function setCountControlValue(count) {
  const normalizedCount = Math.max(1, Math.floor(count));
  const { input, output } = controls.count;

  if (normalizedCount > Number(input.max)) {
    input.max = String(normalizedCount);
  }

  input.value = String(normalizedCount);
  output.value = input.value;
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

function animate(timestamp = 0) {
  const timestampSeconds = Number.isFinite(timestamp) ? timestamp / 1000 : null;
  const dt =
    timestampSeconds !== null && interactivePlaybackTimestamp !== null
      ? Math.min(
          Math.max(0, timestampSeconds - interactivePlaybackTimestamp),
          INTERACTIVE_MAX_DELTA_SECONDS,
        )
      : 0;

  interactivePlaybackTimestamp = timestampSeconds;

  if (timelinePlaying && dt > 0) {
    stepSimulation(dt);
  }

  renderScene(dt);
}

function stepSimulation(dt) {
  simulationTime += dt;
  const trace = simulation.update(
    dt,
    headingDebugger ? { traceIndex: headingDebugger.traceIndex } : undefined,
  );
  updateFishInstances(fishMesh, simulation.fish);
  headingDebugger?.sample({
    dt,
    fish: simulation.fish[fishConfig.highlightedIndex],
    trace,
  });
  cameraRig.updateFishCamera(simulation.fish[fishConfig.highlightedIndex], dt);
}

function renderScene(dt = 0) {
  cameraRig.update(dt);
  cameraPanel?.update();
  renderer.render(scene, cameraRig.activeCamera);
}

function renderCurrentFrame() {
  renderScene(0);
}

function setTimelinePlaying(playing) {
  timelinePlaying = Boolean(playing);
  syncPlaybackControls();
}

function renderAbsoluteFrame(frame, { render = true } = {}) {
  const clampedFrame = clampFrame(frame, renderTimelineTotalFrames);

  resetTimelineState();
  for (let i = 0; i < clampedFrame; i += 1) {
    stepSimulation(STEP_FRAME_SECONDS);
  }

  if (render) {
    renderScene(0);
  }
}

function resetTimelineState() {
  simulationTime = 0;
  applySimulationSettingsFromControls();
  simulation.reset(readControlValue("count"));
  syncFishMeshWithSimulation();
  cameraRig.updateFishCamera(simulation.fish[fishConfig.highlightedIndex], 0);
}

function syncFishMeshWithSimulation() {
  if (!fishMesh || fishMesh.count !== simulation.fish.length) {
    rebuildFishMesh();
    return;
  }

  updateFishInstances(fishMesh, simulation.fish);
}

function syncPlaybackControls() {
  if (!playbackControls) return;

  const { toggleButton, stepButton } = playbackControls;
  toggleButton.textContent = timelinePlaying ? "Pause" : "Resume";
  toggleButton.setAttribute("aria-pressed", String(!timelinePlaying));
  stepButton.disabled = timelinePlaying;
}

function clampFrame(frame, totalFrames = renderTimelineTotalFrames) {
  const maxFrame = Math.max(0, totalFrames - 1);
  if (!Number.isFinite(frame)) {
    return 0;
  }

  return THREE.MathUtils.clamp(Math.round(frame), 0, maxFrame);
}

function isEditingText(target) {
  return (
    (target instanceof HTMLInputElement && textInputTypes.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function resize() {
  const { width, height, pixelRatio } = readRenderSize();
  renderer.setPixelRatio(pixelRatio);
  cameraRig.resize(width, height);
  renderer.setSize(width, height, false);
  cameraPanel?.update();
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
    transparentBackground: exportMode === "transparent" || exportMode === "composite-transparent",
    renderScale: Number.isFinite(renderScale)
      ? THREE.MathUtils.clamp(renderScale, 1, 16)
      : DEFAULT_EXPORT_RENDER_SCALE,
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
      renderAbsoluteFrame(clampedFrame);
      syncPlaybackControls();
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
  const freeCameraButton = getRequiredElement("#free-camera-toggle");
  const copyButton = getRequiredElement("#copy-camera-json");
  const copyStatus = getRequiredElement("#copy-camera-status");
  let copyStatusTimeout = 0;

  freeCameraButton.addEventListener("click", () => {
    rig.setFreeCameraEnabled(!rig.isFreeCameraEnabled);
    renderCurrentFrame();
    update();
  });

  copyButton.addEventListener("click", async () => {
    const json = JSON.stringify(readCameraTransformSnapshot(rig), null, 2);
    const copied = await copyText(json);
    copyStatus.textContent = copied ? "Copied camera JSON" : "Copy failed";
    window.clearTimeout(copyStatusTimeout);
    copyStatusTimeout = window.setTimeout(() => {
      copyStatus.textContent = "";
    }, 1800);
  });

  function syncFreeCameraPan(event, panning) {
    if (!rig.isFreeCameraEnabled || event.code !== "Space" || isEditingText(event.target)) {
      return;
    }

    event.preventDefault();
    rig.setFreeCameraPanning(panning);
  }

  window.addEventListener("keydown", (event) => {
    if (!event.repeat) {
      syncFreeCameraPan(event, true);
    }
  });
  window.addEventListener("keyup", (event) => syncFreeCameraPan(event, false));
  window.addEventListener("blur", () => rig.setFreeCameraPanning(false));

  function update() {
    freeCameraButton.textContent = rig.isFreeCameraEnabled ? "Animated Camera" : "Free Camera";
    freeCameraButton.setAttribute("aria-pressed", String(rig.isFreeCameraEnabled));
  }

  update();

  return { update };
}

function readCameraTransformSnapshot(rig) {
  const camera = rig.activeCamera;

  return {
    mode: rig.mode,
    camera: {
      fov: roundCameraNumber(camera.fov),
      near: roundCameraNumber(camera.near),
      far: roundCameraNumber(camera.far),
      position: vectorToJSON(camera.position),
      target: vectorToJSON(rig.orbitTarget),
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

function readControlValue(key) {
  return readInputNumber(controls[key].input);
}

function syncControlOutput({ input, output }) {
  output.value = input.value;
}

function readInputNumber(input) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : 0;
}

function getRequiredInput(selector) {
  const element = getRequiredElement(selector);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${selector} must be an input.`);
  }
  return element;
}

function getRequiredElement(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`${selector} is required.`);
  }
  return element;
}
