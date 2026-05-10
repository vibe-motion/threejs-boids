import * as THREE from "three";
import { mulberry32 } from "./random.js";

const ORIGIN = new THREE.Vector3(0, 0, 0);
const DEFAULT_FLOW_AXIS = new THREE.Vector3(0, 1, 0);

export class FishSchoolSimulation {
  constructor({ spawnHalfSize, settings }) {
    this.spawnHalfSize = spawnHalfSize;
    this.settings = settings;
    this.fish = [];
    this.random = mulberry32(42);
    this.elapsedTime = 0;

    this.tmpVecA = new THREE.Vector3();
    this.tmpVecB = new THREE.Vector3();
    this.tmpVecC = new THREE.Vector3();
    this.tmpVecD = new THREE.Vector3();
    this.tmpVecE = new THREE.Vector3();
    this.tmpVecF = new THREE.Vector3();
    this.tmpVecG = new THREE.Vector3();
    this.flowAxis = DEFAULT_FLOW_AXIS.clone();
  }

  reset(count, seed = 42) {
    const targetCount = normalizeFishCount(count, 0);
    this.fish.length = 0;
    this.random = mulberry32(seed);
    this.elapsedTime = 0;

    for (let i = 0; i < targetCount; i += 1) {
      this.fish.push(this.createFish());
    }
  }

  setCount(count) {
    const targetCount = normalizeFishCount(count, this.fish.length);

    if (targetCount < this.fish.length) {
      this.fish.length = targetCount;
      return;
    }

    while (this.fish.length < targetCount) {
      this.fish.push(this.createFish());
    }
  }

  createFish() {
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
    };
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
      this.fish[i].velocity.copy(nextVelocities[i]);
      this.fish[i].position.copy(nextPositions[i]);
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

    if (distance > targetRadius) {
      const overshoot = THREE.MathUtils.clamp((distance - targetRadius) / targetRadius, 0, 1);
      force.addScaledVector(radialDirection, -1 - overshoot);
    } else if (distance < coreRadius) {
      const corePressure = 1 - distance / coreRadius;
      force.addScaledVector(radialDirection, corePressure);
    } else {
      const inwardBias = 0.28 * (distance / targetRadius);
      force.addScaledVector(radialDirection, -inwardBias);
    }

    return this.steerTowards(force, velocity);
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
