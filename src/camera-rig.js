import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getFishHeadPose } from "./fish-renderer.js";

const CAMERA_MODE = {
  orbit: "orbit",
  fish: "fish",
};

const FISH_CAMERA_POSITION_RESPONSE = 10;
const FISH_CAMERA_DIRECTION_RESPONSE = 5;
const FISH_CAMERA_LOOK_AHEAD = 3.6;
const DEFAULT_ORBIT_VIEW_SPEED = 4.2;
const MIN_ORBIT_VIEW_DURATION = 0.001;
const worldUp = new THREE.Vector3(0, 1, 0);
const fallbackUp = new THREE.Vector3(1, 0, 0);

export function createCameraRig(renderer) {
  const orbitCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
  orbitCamera.position.set(0, 8.5, 20);

  const fishCamera = new THREE.PerspectiveCamera(74, 1, 0.03, 90);

  const controls = new OrbitControls(orbitCamera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.8, 0);
  controls.maxDistance = 38;
  controls.minDistance = 8;

  const pose = {
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, -1),
  };
  const smoothedFishPosition = new THREE.Vector3();
  const smoothedFishDirection = new THREE.Vector3(0, 0, -1);
  const target = new THREE.Vector3();
  const up = new THREE.Vector3();
  const orbitViewGoal = {
    startPosition: new THREE.Vector3(),
    position: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    target: new THREE.Vector3(),
    startUp: new THREE.Vector3(),
    up: new THREE.Vector3(),
    elapsed: 0,
    duration: MIN_ORBIT_VIEW_DURATION,
  };
  let mode = CAMERA_MODE.orbit;
  let fishCameraInitialized = false;
  let orbitViewTransitionActive = false;

  controls.addEventListener("start", () => {
    orbitViewTransitionActive = false;
  });

  function applyOrbitView({
    position,
    target: viewTarget = controls.target,
    up: viewUp = worldUp,
  }) {
    controls.target.copy(viewTarget);
    orbitCamera.up.copy(viewUp);
    orbitCamera.position.copy(position);
    orbitCamera.lookAt(controls.target);
    controls.update();
  }

  function setOrbitMode() {
    mode = CAMERA_MODE.orbit;
    controls.enabled = true;
  }

  function updateOrbitViewTransition(dt) {
    if (!orbitViewTransitionActive || dt <= 0) {
      return;
    }

    orbitViewGoal.elapsed += dt;
    const progress = Math.min(1, orbitViewGoal.elapsed / orbitViewGoal.duration);
    orbitCamera.position.lerpVectors(
      orbitViewGoal.startPosition,
      orbitViewGoal.position,
      progress,
    );
    controls.target.lerpVectors(
      orbitViewGoal.startTarget,
      orbitViewGoal.target,
      progress,
    );
    orbitCamera.up
      .lerpVectors(orbitViewGoal.startUp, orbitViewGoal.up, progress)
      .normalize();
    orbitCamera.lookAt(controls.target);

    if (progress >= 1) {
      orbitViewTransitionActive = false;
      orbitCamera.position.copy(orbitViewGoal.position);
      controls.target.copy(orbitViewGoal.target);
      orbitCamera.up.copy(orbitViewGoal.up);
      orbitCamera.lookAt(controls.target);
    }
  }

  return {
    get activeCamera() {
      return mode === CAMERA_MODE.fish ? fishCamera : orbitCamera;
    },

    get mode() {
      return mode;
    },

    toggle() {
      orbitViewTransitionActive = false;
      mode = mode === CAMERA_MODE.orbit ? CAMERA_MODE.fish : CAMERA_MODE.orbit;
      controls.enabled = mode === CAMERA_MODE.orbit;
    },

    setOrbitView(view) {
      orbitViewTransitionActive = false;
      setOrbitMode();
      applyOrbitView(view);
    },

    flyToOrbitView({
      position,
      target: viewTarget = controls.target,
      up: viewUp = worldUp,
      speed = DEFAULT_ORBIT_VIEW_SPEED,
    }) {
      setOrbitMode();
      orbitViewGoal.startPosition.copy(orbitCamera.position);
      orbitViewGoal.position.copy(position);
      orbitViewGoal.startTarget.copy(controls.target);
      orbitViewGoal.target.copy(viewTarget);
      orbitViewGoal.startUp.copy(orbitCamera.up).normalize();
      orbitViewGoal.up.copy(viewUp).normalize();
      orbitViewGoal.elapsed = 0;
      orbitViewGoal.duration = Math.max(
        MIN_ORBIT_VIEW_DURATION,
        orbitCamera.position.distanceTo(position) / Math.max(0.001, speed),
      );
      orbitViewTransitionActive = true;
    },

    get isOrbitViewTransitionActive() {
      return orbitViewTransitionActive;
    },

    update(dt = 0) {
      if (mode === CAMERA_MODE.orbit) {
        updateOrbitViewTransition(dt);
      }

      if (controls.enabled) {
        controls.update();
      }
    },

    updateFishCamera(fish, dt = 0) {
      if (!fish) return;

      getFishHeadPose(fish, pose);

      if (!fishCameraInitialized || dt <= 0) {
        smoothedFishPosition.copy(pose.position);
        smoothedFishDirection.copy(pose.direction);
        fishCameraInitialized = true;
      } else {
        const positionAlpha = 1 - Math.exp(-FISH_CAMERA_POSITION_RESPONSE * dt);
        const directionAlpha = 1 - Math.exp(-FISH_CAMERA_DIRECTION_RESPONSE * dt);
        smoothedFishPosition.lerp(pose.position, positionAlpha);
        smoothedFishDirection.lerp(pose.direction, directionAlpha).normalize();
      }

      fishCamera.position.copy(smoothedFishPosition);
      up.copy(worldUp).addScaledVector(
        smoothedFishDirection,
        -worldUp.dot(smoothedFishDirection),
      );
      if (up.lengthSq() < 0.0001) {
        up.copy(fallbackUp).addScaledVector(
          smoothedFishDirection,
          -fallbackUp.dot(smoothedFishDirection),
        );
      }
      fishCamera.up.copy(up.normalize());
      fishCamera.lookAt(
        target
          .copy(smoothedFishPosition)
          .addScaledVector(smoothedFishDirection, FISH_CAMERA_LOOK_AHEAD),
      );
    },

    resize(width, height) {
      const aspect = Math.max(1, width) / Math.max(1, height);

      orbitCamera.aspect = aspect;
      orbitCamera.updateProjectionMatrix();
      fishCamera.aspect = aspect;
      fishCamera.updateProjectionMatrix();
    },
  };
}

export function bindCameraToggle(cameraRig) {
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;

    event.preventDefault();
    cameraRig.toggle();
  });
}
