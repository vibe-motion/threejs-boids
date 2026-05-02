import * as THREE from "three";

export const aquariumHalfSize = new THREE.Vector3(11, 6.6, 8.5);
export const aquariumSize = aquariumHalfSize.clone().multiplyScalar(2);
export const aquariumFloorY = -aquariumHalfSize.y;
export const waterLevelY = aquariumHalfSize.y - 0.72;

export const fishConfig = {
  radius: 0.3,
  length: 0.8,
  highlightedScale: 1,
  radialSegments: 36,
  heightSegments: 3,
  highlightedIndex: 0,
  bodyColor: new THREE.Color(0xffffff),
  highlightedColor: new THREE.Color(0xffffff),
};

export const simulationSettings = {
  minSpeed: 2.8,
  maxSpeed: 7,
  maxTurnRate: 18,
  perceptionRadius: 4.2,
  avoidanceRadius: 1.4,
  maxSteerForce: 4.2,
  alignWeight: 1.2,
  cohesionWeight: 1,
  separateWeight: 1,
  boundsRadius: 0.27,
  avoidCollisionWeight: 4,
  collisionAvoidDistance: 7,
  sphereSeparationMargin: 4,
  sphereSeparationWeight: 20,
  boundaryWeight: 9,
  boundaryMargin: 2.8,
};

export const obstacles = [
  {
    shape: "sphere",
    position: new THREE.Vector3(3.6, -0.8, -2.35),
    radius: 1.557692,
    bodyColor: new THREE.Color(0xd91f1f),
    outlineColor: new THREE.Color(0x050505),
  },
];
