import * as THREE from "three";

export { fishConfig } from "./fish/config.js";

export const schoolSpawnHalfSize = new THREE.Vector3(8.5, 5.2, 6.6);

export const simulationSettings = {
  minSpeed: 2.8,
  maxSpeed: 7,
  maxTurnRate: 18,
  baitBallRadius: 3.3,
  baitBallCoreRatio: 0.34,
  perceptionRadius: 4.2,
  separationRadius: 1.25,
  maxSteerForce: 4.2,
  alignWeight: 0.5,
  cohesionWeight: 0.9,
  separateWeight: 3,
  centeringWeight: 1.4,
  toroidalFlowWeight: 1.9,
  toroidalRollWeight: 0.38,
  toroidalAxisSpeed: 0.42,
  boundsRadius: 0.27,
  avoidCollisionWeight: 4,
  collisionAvoidDistance: 7,
  sphereSeparationMargin: 4,
  sphereSeparationWeight: 20,
};

export const renderSettings = {
  motionBlurIntensity: 0.4,
};

export const obstacles = [
  {
    shape: "sphere",
    position: new THREE.Vector3(3.6, -0.8, -2.35),
    radius: 1.557692,
    movementBounds: {
      min: new THREE.Vector3(-8.9, -4.8, -12.4),
      max: new THREE.Vector3(16.4, 5.2, 8.2),
    },
    modelUrl: new URL("./fish/clawd.glb", import.meta.url),
    modelForward: new THREE.Vector3(0, -1, 0),
    modelBrightness: 1.58,
    modelEmissiveIntensity: 0,
  },
];
