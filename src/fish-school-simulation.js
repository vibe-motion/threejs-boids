import * as THREE from "three";
import {
  createFishMotionScratch,
  createFishMotionState,
  updateFishMotionState,
} from "./fish/motion-state.js";
import {
  createRayDirections,
  mulberry32,
} from "./random.js";

const ORIGIN = new THREE.Vector3(0, 0, 0);
const DEFAULT_FLOW_AXIS = new THREE.Vector3(0, 1, 0);
const MIN_CACHED_CLEAR_DIRECTION_DOT = 0.5;

export class FishSchoolSimulation {
  constructor({ spawnHalfSize, obstacles = [], settings }) {
    this.spawnHalfSize = spawnHalfSize;
    this.obstacles = obstacles;
    this.settings = settings;
    this.fish = [];
    this.random = mulberry32(42);
    this.elapsedTime = 0;
    this.rayDirections = createRayDirections(300);
    this.fishMotionScratch = createFishMotionScratch();

    this.tmpVecA = new THREE.Vector3();
    this.tmpVecB = new THREE.Vector3();
    this.tmpVecC = new THREE.Vector3();
    this.tmpVecD = new THREE.Vector3();
    this.tmpVecE = new THREE.Vector3();
    this.tmpVecF = new THREE.Vector3();
    this.tmpVecG = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.flowAxis = DEFAULT_FLOW_AXIS.clone();
    this.forwardAxis = new THREE.Vector3(0, 0, 1);
  }

  reset(count, seed = 42) {
    const targetCount = normalizeFishCount(count, 0);
    this.fish.length = 0;
    this.random = mulberry32(seed);
    this.elapsedTime = 0;

    for (let i = 0; i < targetCount; i += 1) {
      this.fish.push(this.createFish(i));
    }
  }

  setCount(count) {
    const targetCount = normalizeFishCount(count, this.fish.length);

    if (targetCount < this.fish.length) {
      this.fish.length = targetCount;
      return;
    }

    while (this.fish.length < targetCount) {
      this.fish.push(this.createFish(this.fish.length));
    }
  }

  createFish(index = this.fish.length) {
    const position = this.createInitialPosition();
    const direction = this.createInitialDirection(position);
    const speed = THREE.MathUtils.lerp(
      this.settings.minSpeed,
      this.settings.maxSpeed,
      this.random(),
    );

    return {
      position,
      velocity: direction.multiplyScalar(speed),
      collisionAvoidanceDirection: null,
      ...this.createMotionState(index),
    };
  }

  createMotionState(index = this.fish.length) {
    return createFishMotionState(index);
  }

  createInitialPosition() {
    const radius = this.settings.baitBallRadius ?? 6.2;
    const direction = this.createRandomUnitVector();
    const shellBias = 0.32 + 0.68 * Math.cbrt(this.random());

    return direction.multiplyScalar(radius * shellBias);
  }

  createInitialDirection(position) {
    const tangent = new THREE.Vector3().crossVectors(DEFAULT_FLOW_AXIS, position);
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(new THREE.Vector3(1, 0, 0), position);
    }

    tangent.normalize();
    tangent.addScaledVector(position.clone().normalize(), (this.random() * 2 - 1) * 0.18);
    return tangent.normalize();
  }

  createRandomUnitVector() {
    const z = this.random() * 2 - 1;
    const angle = this.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));

    return new THREE.Vector3(
      Math.cos(angle) * radius,
      z,
      Math.sin(angle) * radius,
    );
  }

  update(dt, options = {}) {
    const nextVelocities = new Array(this.fish.length);
    const nextPositions = new Array(this.fish.length);
    const flowAxis = this.readFlowAxis(this.elapsedTime);
    const flowPhase = this.elapsedTime * (this.settings.toroidalAxisSpeed ?? 0.42) * 3.7;
    let trace = null;

    for (let i = 0; i < this.fish.length; i += 1) {
      const fish = this.fish[i];
      const acceleration = new THREE.Vector3();
      const components = options.traceIndex === i ? {
        align: new THREE.Vector3(),
        cohesion: new THREE.Vector3(),
        separation: new THREE.Vector3(),
        centering: new THREE.Vector3(),
        toroidal: new THREE.Vector3(),
        sphereSeparation: new THREE.Vector3(),
        obstacle: new THREE.Vector3(),
      } : null;
      const headingSum = new THREE.Vector3();
      const centerSum = new THREE.Vector3();
      const separationSum = new THREE.Vector3();
      let neighborCount = 0;

      for (let j = 0; j < this.fish.length; j += 1) {
        if (i === j) continue;
        const other = this.fish[j];
        const offset = this.tmpVecA.subVectors(other.position, fish.position);
        const distanceSq = offset.lengthSq();

        if (distanceSq < this.settings.perceptionRadius * this.settings.perceptionRadius) {
          neighborCount += 1;
          headingSum.add(this.tmpVecB.copy(other.velocity).normalize());
          centerSum.add(other.position);

          if (distanceSq < this.settings.separationRadius * this.settings.separationRadius) {
            const distance = Math.sqrt(Math.max(distanceSq, 0.0001));
            separationSum.add(this.tmpVecC.copy(offset).multiplyScalar(-1 / distance));
          }
        }
      }

      if (neighborCount > 0) {
        centerSum.multiplyScalar(1 / neighborCount);
        const align = this.steerTowards(headingSum, fish.velocity).multiplyScalar(
          this.settings.alignWeight,
        );
        const cohesion = this.steerTowards(
          centerSum.sub(fish.position),
          fish.velocity,
        ).multiplyScalar(
          this.settings.cohesionWeight,
        );
        const separation = this.steerTowards(
          separationSum,
          fish.velocity,
        ).multiplyScalar(
          this.settings.separateWeight,
        );

        acceleration.add(align);
        acceleration.add(cohesion);
        acceleration.add(separation);

        if (components) {
          components.align.copy(align);
          components.cohesion.copy(cohesion);
          components.separation.copy(separation);
        }
      }

      const centering = this.sphericalEnvelopeForce(
        fish.position,
        fish.velocity,
      ).multiplyScalar(this.settings.centeringWeight);
      acceleration.add(centering);
      if (components) {
        components.centering.copy(centering);
      }

      const toroidal = this.toroidalFlowForce(
        fish.position,
        fish.velocity,
        flowAxis,
        flowPhase,
      ).multiplyScalar(this.settings.toroidalFlowWeight);
      acceleration.add(toroidal);
      if (components) {
        components.toroidal.copy(toroidal);
      }

      const sphereSeparation = this.sphereObstacleSeparationForce(
        fish.position,
        fish.velocity,
      );
      if (sphereSeparation.lengthSq() > 0) {
        acceleration.add(sphereSeparation);
        if (components) {
          components.sphereSeparation.copy(sphereSeparation);
        }
      }

      const forward = this.tmpVecB.copy(fish.velocity).normalize();
      if (this.isHeadingForCollision(fish.position, forward)) {
        const clearDirection = this.obstacleRays(fish.position, forward, fish);
        const obstacle = this.steerTowards(
          clearDirection,
          fish.velocity,
        ).multiplyScalar(
          this.settings.avoidCollisionWeight,
        );
        acceleration.add(obstacle);
        if (components) {
          components.obstacle.copy(obstacle);
        }
      } else {
        fish.collisionAvoidanceDirection = null;
      }

      const desiredVelocity = fish.velocity.clone().add(acceleration.multiplyScalar(dt));
      const speed = THREE.MathUtils.clamp(
        desiredVelocity.length(),
        this.settings.minSpeed,
        this.settings.maxSpeed,
      );
      desiredVelocity.normalize().multiplyScalar(speed);
      const velocity = this.limitTurn(fish.velocity, desiredVelocity, dt);

      nextVelocities[i] = velocity;
      nextPositions[i] = fish.position.clone().addScaledVector(velocity, dt);

      if (components) {
        trace = {
          components,
          neighborCount,
          previousVelocity: fish.velocity.clone(),
          nextVelocity: velocity.clone(),
        };
      }
    }

    for (let i = 0; i < this.fish.length; i += 1) {
      const fish = this.fish[i];
      updateFishMotionState(fish, nextVelocities[i], dt, this.fishMotionScratch);
      fish.velocity.copy(nextVelocities[i]);
      fish.position.copy(nextPositions[i]);
    }

    this.elapsedTime += dt;

    return trace;
  }

  steerTowards(vector, velocity) {
    if (vector.lengthSq() < 0.000001) {
      return new THREE.Vector3();
    }

    const desired = vector.clone().normalize().multiplyScalar(this.settings.maxSpeed);
    return desired.sub(velocity).clampLength(0, this.settings.maxSteerForce);
  }

  sphereObstacleSeparationForce(position, velocity) {
    const margin = Math.max(0, this.settings.sphereSeparationMargin ?? 0);
    const weight = Math.max(0, this.settings.sphereSeparationWeight ?? 0);
    if (margin <= 0 || weight <= 0 || this.obstacles.length === 0) {
      return new THREE.Vector3();
    }

    const away = new THREE.Vector3();
    let maxPressure = 0;

    for (const obstacle of this.obstacles) {
      if (obstacle.shape !== "sphere" || !Number.isFinite(obstacle.radius)) {
        continue;
      }

      const radius = obstacle.radius;
      const influenceRadius = radius + margin;
      const offset = this.tmpVecE.subVectors(position, obstacle.position);
      const distanceSq = offset.lengthSq();

      if (distanceSq >= influenceRadius * influenceRadius) {
        continue;
      }

      let distance = Math.sqrt(distanceSq);
      if (distance < 0.000001) {
        offset.copy(velocity).multiplyScalar(-1);
        if (offset.lengthSq() < 0.000001) {
          offset.set(1, 0, 0);
        }
        distance = offset.length();
      }

      const surfaceDistance = distance - radius;
      const pressure =
        surfaceDistance >= 0
          ? 1 - surfaceDistance / margin
          : 1 + Math.min(1, -surfaceDistance / Math.max(radius, 0.000001));

      away.addScaledVector(offset, pressure / distance);
      maxPressure = Math.max(maxPressure, pressure);
    }

    if (away.lengthSq() < 0.000001) {
      return away;
    }

    return this.steerTowards(away, velocity).multiplyScalar(weight * maxPressure);
  }

  isHeadingForCollision(position, forward) {
    return (
      this.obstacles.length > 0
      && this.rayHitsObstacle(
        position,
        forward,
        this.settings.collisionAvoidDistance,
      )
    );
  }

  obstacleRays(position, forward, fish = null) {
    const cachedDirection = fish?.collisionAvoidanceDirection;

    if (
      cachedDirection
      && cachedDirection.dot(forward) > MIN_CACHED_CLEAR_DIRECTION_DOT
      && this.isDirectionClear(
        position,
        cachedDirection,
        this.settings.collisionAvoidDistance,
      )
    ) {
      return cachedDirection;
    }

    const result = this.findClearObstacleDirection(position, forward);
    if (fish) {
      if (!fish.collisionAvoidanceDirection) {
        fish.collisionAvoidanceDirection = new THREE.Vector3();
      }
      fish.collisionAvoidanceDirection.copy(result.direction);
      return fish.collisionAvoidanceDirection;
    }

    return result.direction;
  }

  findClearObstacleDirection(position, forward) {
    const forwardDirection = forward.clone().normalize();
    const maxDistance = this.settings.collisionAvoidDistance;
    this.tmpQuat.setFromUnitVectors(this.forwardAxis, forwardDirection);

    for (const localDirection of this.rayDirections) {
      const direction = this.tmpVecA
        .copy(localDirection)
        .applyQuaternion(this.tmpQuat)
        .normalize();

      if (this.isDirectionClear(position, direction, maxDistance)) {
        return {
          direction: direction.clone(),
        };
      }
    }

    return {
      direction: forwardDirection,
    };
  }

  isDirectionClear(origin, direction, maxDistance) {
    return (
      this.obstacles.length === 0
      || !this.rayHitsObstacle(origin, direction, maxDistance)
    );
  }

  rayHitsObstacle(origin, direction, maxDistance) {
    return Number.isFinite(this.rayObstacleHitDistance(origin, direction, maxDistance));
  }

  rayObstacleHitDistance(origin, direction, maxDistance = Infinity) {
    if (this.obstacles.length === 0) {
      return Infinity;
    }

    let nearestDistance = Infinity;

    for (const obstacle of this.obstacles) {
      const distance = this.raySingleObstacleHitDistance(
        origin,
        direction,
        Math.min(maxDistance, nearestDistance),
        obstacle,
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
      }
    }

    return nearestDistance <= maxDistance ? nearestDistance : Infinity;
  }

  raySingleObstacleHitDistance(origin, direction, maxDistance, obstacle) {
    if ((obstacle.shape === "box" || obstacle.shape === "plate") && obstacle.size) {
      return this.rayBoxObstacleHitDistance(origin, direction, maxDistance, obstacle);
    }

    return this.raySphereObstacleHitDistance(origin, direction, maxDistance, obstacle);
  }

  rayBoxObstacleHitDistance(origin, direction, maxDistance, obstacle) {
    const localOrigin = this.tmpVecC.subVectors(origin, obstacle.position);
    const localDirection = this.tmpVecD.copy(direction);

    if (obstacle.rotationY) {
      this.rotateAroundY(localOrigin, -obstacle.rotationY);
      this.rotateAroundY(localDirection, -obstacle.rotationY);
    }

    const inset = this.settings.boundsRadius ?? 0;
    const halfX = obstacle.size.x * 0.5 + inset;
    const halfY = obstacle.size.y * 0.5 + inset;
    const halfZ = obstacle.size.z * 0.5 + inset;

    return rayExpandedBoxHitDistance(
      localOrigin,
      localDirection,
      halfX,
      halfY,
      halfZ,
      maxDistance,
    );
  }

  raySphereObstacleHitDistance(origin, direction, maxDistance, obstacle) {
    const radius = obstacle.radius + (this.settings.boundsRadius ?? 0);
    const offset = this.tmpVecC.subVectors(origin, obstacle.position);
    const b = offset.dot(direction);
    const c = offset.lengthSq() - radius * radius;
    const discriminant = b * b - c;

    if (discriminant < 0) {
      return Infinity;
    }

    const root = Math.sqrt(discriminant);
    const near = -b - root;
    const far = -b + root;

    if (near >= 0 && near <= maxDistance) {
      return near;
    }

    return far >= 0 && far <= maxDistance ? far : Infinity;
  }

  rotateAroundY(vector, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = vector.x;
    const z = vector.z;

    vector.x = x * cos + z * sin;
    vector.z = -x * sin + z * cos;
    return vector;
  }

  limitTurn(currentVelocity, desiredVelocity, dt) {
    const currentDirection = currentVelocity.clone().normalize();
    const desiredDirection = desiredVelocity.clone().normalize();
    const angle = currentDirection.angleTo(desiredDirection);
    const maxAngle = this.settings.maxTurnRate * dt;

    if (angle <= maxAngle || angle < 0.000001) {
      return desiredVelocity;
    }

    const t = maxAngle / angle;
    const sinAngle = Math.sin(angle);
    let direction;

    if (Math.abs(sinAngle) > 0.000001) {
      direction = currentDirection
        .multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
        .add(desiredDirection.multiplyScalar(Math.sin(t * angle) / sinAngle))
        .normalize();
    } else {
      direction = currentDirection.lerp(desiredDirection, t).normalize();
    }

    return direction.multiplyScalar(desiredVelocity.length());
  }

  sphericalEnvelopeForce(position, velocity) {
    const targetRadius = Math.max(0.001, this.settings.baitBallRadius ?? 6.2);
    const coreRadius = targetRadius * (this.settings.baitBallCoreRatio ?? 0.34);
    const distance = position.length();

    if (distance < 0.000001) {
      return new THREE.Vector3();
    }

    const radialDirection = this.tmpVecD.copy(position).multiplyScalar(1 / distance);
    const force = this.tmpVecE.set(0, 0, 0);
    let pressure = 1;

    if (distance > targetRadius) {
      const overshoot = Math.max(0, (distance - targetRadius) / targetRadius);
      pressure = 1 + overshoot * 3;
      force.addScaledVector(radialDirection, -1 - overshoot);
    } else if (distance < coreRadius) {
      const corePressure = 1 - distance / coreRadius;
      pressure = 0.5 + corePressure * 1.5;
      force.addScaledVector(radialDirection, corePressure);
    } else {
      const inwardBias = 0.28 * (distance / targetRadius);
      pressure = 0.55 + inwardBias;
      force.addScaledVector(radialDirection, -inwardBias);
    }

    return this.steerTowards(force, velocity).multiplyScalar(pressure);
  }

  toroidalFlowForce(position, velocity, axis, phase) {
    const radial = this.tmpVecD.copy(position).sub(ORIGIN);
    if (radial.lengthSq() < 0.000001) {
      return new THREE.Vector3();
    }

    const axialOffset = radial.dot(axis);
    const ringRadial = this.tmpVecE.copy(radial).addScaledVector(axis, -axialOffset);
    if (ringRadial.lengthSq() < 0.000001) {
      ringRadial.crossVectors(axis, velocity);
      if (ringRadial.lengthSq() < 0.000001) {
        ringRadial.crossVectors(axis, new THREE.Vector3(1, 0, 0));
      }
    }

    const toroidal = this.tmpVecF.crossVectors(axis, ringRadial).normalize();
    const radialDirection = radial.normalize();
    const poloidal = this.tmpVecG.crossVectors(toroidal, radialDirection).normalize();
    const roll = Math.sin(phase + axialOffset * 0.72);
    const desiredDirection = toroidal.addScaledVector(
      poloidal,
      roll * (this.settings.toroidalRollWeight ?? 0.38),
    );

    return this.steerTowards(desiredDirection, velocity);
  }

  readFlowAxis(time) {
    const speed = this.settings.toroidalAxisSpeed ?? 0.42;
    return this.flowAxis.set(
      Math.sin(time * speed * 0.83) * 0.62,
      1 + Math.sin(time * speed * 0.47) * 0.22,
      Math.cos(time * speed) * 0.62,
    ).normalize();
  }
}

function normalizeFishCount(count, fallback) {
  if (!Number.isFinite(count)) {
    return fallback;
  }

  return Math.max(0, Math.floor(count));
}

function rayExpandedBoxHitDistance(origin, direction, halfX, halfY, halfZ, maxDistance) {
  let near = 0;
  let far = maxDistance;

  if (Math.abs(direction.x) < 0.000001) {
    if (origin.x < -halfX || origin.x > halfX) return Infinity;
  } else {
    const inverseDirection = 1 / direction.x;
    let axisNear = (-halfX - origin.x) * inverseDirection;
    let axisFar = (halfX - origin.x) * inverseDirection;
    if (axisNear > axisFar) {
      const swap = axisNear;
      axisNear = axisFar;
      axisFar = swap;
    }
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (near > far) return Infinity;
  }

  if (Math.abs(direction.y) < 0.000001) {
    if (origin.y < -halfY || origin.y > halfY) return Infinity;
  } else {
    const inverseDirection = 1 / direction.y;
    let axisNear = (-halfY - origin.y) * inverseDirection;
    let axisFar = (halfY - origin.y) * inverseDirection;
    if (axisNear > axisFar) {
      const swap = axisNear;
      axisNear = axisFar;
      axisFar = swap;
    }
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (near > far) return Infinity;
  }

  if (Math.abs(direction.z) < 0.000001) {
    if (origin.z < -halfZ || origin.z > halfZ) return Infinity;
  } else {
    const inverseDirection = 1 / direction.z;
    let axisNear = (-halfZ - origin.z) * inverseDirection;
    let axisFar = (halfZ - origin.z) * inverseDirection;
    if (axisNear > axisFar) {
      const swap = axisNear;
      axisNear = axisFar;
      axisFar = swap;
    }
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (near > far) return Infinity;
  }

  return far >= 0 && near <= maxDistance ? near : Infinity;
}
