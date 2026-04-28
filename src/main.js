import * as THREE from "three";
import { FishSchoolSimulation } from "./fish-school-simulation.js";
import { bindCameraToggle, createCameraRig } from "./camera-rig.js";
import { aquariumHalfSize, fishConfig, obstacles, simulationSettings } from "./config.js";
import {
  createFishMesh,
  disposeFishMesh,
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
    position: new THREE.Vector3(0, 1.4, 22),
    target: cameraViewTarget,
  },
  default: {
    position: new THREE.Vector3(0, 8.5, 20),
    target: cameraViewTarget,
  },
};

let fishMesh = null;
let simulationPaused = false;
let pendingSimulationSteps = 0;
let simulationTime = 0;

const lighting = addLighting(scene);
lighting.setIntensity(readControlValue("light"));
const aquariumEffects = addAquarium(scene);
addWorldAxes(scene);
const obstacleMeshes = addObstacles(scene, obstacles);
applySimulationSettingsFromControls();
bindControls();
bindPlaybackControls();
bindCameraToggle(cameraRig);
bindObstacleKeyboardControls(obstacleMeshes);
bindCameraViewControls(cameraRig);
cameraRig.setOrbitView(cameraViewPresets.x);
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

  toggleButton.addEventListener("click", () => {
    simulationPaused = !simulationPaused;
    if (!simulationPaused) {
      pendingSimulationSteps = 0;
    }
    syncPlaybackControls(toggleButton, stepButton);
  });

  stepButton.addEventListener("click", () => {
    if (!simulationPaused) return;

    pendingSimulationSteps += 1;
  });

  syncPlaybackControls(toggleButton, stepButton);
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
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function syncPlaybackControls(toggleButton, stepButton) {
  toggleButton.textContent = simulationPaused ? "Resume" : "Pause";
  toggleButton.setAttribute("aria-pressed", String(simulationPaused));
  stepButton.disabled = !simulationPaused;
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
  const simulationDt = getSimulationDelta(frameDt);
  let trace = null;

  if (simulationDt > 0) {
    simulationTime += simulationDt;
    trace = simulation.update(simulationDt, {
      traceIndex: headingDebugger?.traceIndex,
    });
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

  cameraRig.update();
  cameraPanel.update();
  renderer.render(scene, cameraRig.activeCamera);
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
