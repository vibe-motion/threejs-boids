import * as THREE from "three";

export const aquariumHalfSize = new THREE.Vector3(11, 6.6, 8.5);
export const aquariumSize = aquariumHalfSize.clone().multiplyScalar(2);
export const aquariumFloorY = -aquariumHalfSize.y;
export const waterLevelY = aquariumHalfSize.y - 0.72;

export const fishConfig = {
  radius: 0.18,
  length: 0.8,
  radialSegments: 14,
  highlightedIndex: 0,
  bodyColor: new THREE.Color(0x7c6dff),
  highlightedColor: new THREE.Color(0xfff000),
};

export const simulationSettings = {
  minSpeed: 2,
  maxSpeed: 5,
  maxTurnRate: 1,
  perceptionRadius: 3,
  avoidanceRadius: 1,
  maxSteerForce: 3,
  alignWeight: 0,
  cohesionWeight: 0,
  separateWeight: 0,
  boundsRadius: 0.27,
  avoidCollisionWeight: 10,
  collisionAvoidDistance: 5,
  boundaryWeight: 9,
  boundaryMargin: 2,
};

export const obstacles = [];
