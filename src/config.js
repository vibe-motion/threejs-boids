import * as THREE from "three";

export const schoolSpawnHalfSize = new THREE.Vector3(8.5, 5.2, 6.6);
export const schoolRenderRadius = schoolSpawnHalfSize.length() + 2;

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
  baitBallRadius: 6.2,
  baitBallCoreRatio: 0.34,
  perceptionRadius: 4.2,
  separationRadius: 1.25,
  maxSteerForce: 4.2,
  alignWeight: 1.2,
  cohesionWeight: 0.9,
  separateWeight: 1.4,
  centeringWeight: 1.4,
  toroidalFlowWeight: 1.9,
  toroidalRollWeight: 0.38,
  toroidalAxisSpeed: 0.42,
};
