import * as THREE from "three";
import { fishConfig } from "./config.js";

const DEFAULT_FORWARD = new THREE.Vector3(0, 1, 0);
const tmpDirection = new THREE.Vector3();

export function resetFishTrailHistory(fish) {
  if (!fish?.position) {
    return;
  }

  const direction = readTrailDirection(fish, tmpDirection);
  const maxLength = readMaxTrailHistoryLength();
  const spacing = readTrailHistorySampleSpacing();
  const pointCount = Math.ceil(maxLength / spacing) + 1;

  fish.trailHistory = [];
  fish.trailHistoryPool = [];

  for (let i = 0; i < pointCount; i += 1) {
    const distance = Math.min(i * spacing, maxLength);
    fish.trailHistory.push(fish.position.clone().addScaledVector(direction, -distance));
  }
}

export function updateFishTrailHistory(fish) {
  if (!fish?.position) {
    return;
  }

  if (!fish.trailHistory?.length) {
    resetFishTrailHistory(fish);
    return;
  }

  const history = fish.trailHistory;
  const head = history[0];
  const distance = head.distanceTo(fish.position);

  if (distance <= 0.000001) {
    head.copy(fish.position);
    return;
  }

  const spacing = readTrailHistorySampleSpacing();
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const startX = head.x;
  const startY = head.y;
  const startZ = head.z;

  for (let step = 1; step <= steps; step += 1) {
    const alpha = step / steps;
    const point = acquireTrailPoint(fish);
    point.set(
      THREE.MathUtils.lerp(startX, fish.position.x, alpha),
      THREE.MathUtils.lerp(startY, fish.position.y, alpha),
      THREE.MathUtils.lerp(startZ, fish.position.z, alpha),
    );
    history.unshift(point);
  }

  trimTrailHistory(fish, readMaxTrailHistoryLength());
}

export function sampleFishTrailCenters(fish, trailLength, segments, targets) {
  const history = fish?.trailHistory;
  if (!history?.length) {
    const fallback = fish?.position;
    for (let i = 0; i <= segments; i += 1) {
      if (fallback) {
        targets[i].copy(fallback);
      } else {
        targets[i].set(0, 0, 0);
      }
    }
    return;
  }

  if (history.length === 1) {
    for (let i = 0; i <= segments; i += 1) {
      targets[i].copy(history[0]);
    }
    return;
  }

  let historyIndex = 1;
  let accumulated = 0;

  for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
    const targetDistance = Math.max(0, trailLength) * (segmentIndex / Math.max(1, segments));
    const target = targets[segmentIndex];

    if (targetDistance <= 0) {
      target.copy(history[0]);
      continue;
    }

    let found = false;
    while (historyIndex < history.length) {
      const previous = history[historyIndex - 1];
      const current = history[historyIndex];
      const segmentLength = previous.distanceTo(current);

      if (segmentLength <= 0.000001) {
        historyIndex += 1;
        continue;
      }

      if (accumulated + segmentLength >= targetDistance) {
        const alpha = (targetDistance - accumulated) / segmentLength;
        target.lerpVectors(previous, current, alpha);
        found = true;
        break;
      }

      accumulated += segmentLength;
      historyIndex += 1;
    }

    if (!found) {
      target.copy(history[history.length - 1]);
    }
  }
}

function trimTrailHistory(fish, maxLength) {
  const history = fish.trailHistory;
  let accumulated = 0;

  for (let i = 1; i < history.length; i += 1) {
    const previous = history[i - 1];
    const current = history[i];
    const segmentLength = previous.distanceTo(current);

    if (segmentLength <= 0.000001) {
      continue;
    }

    if (accumulated + segmentLength > maxLength) {
      const alpha = (maxLength - accumulated) / segmentLength;
      current.lerpVectors(previous, current, THREE.MathUtils.clamp(alpha, 0, 1));
      releaseTrailPoints(fish, i + 1);
      return;
    }

    accumulated += segmentLength;
  }
}

function acquireTrailPoint(fish) {
  return fish.trailHistoryPool?.pop() ?? new THREE.Vector3();
}

function releaseTrailPoints(fish, startIndex) {
  const history = fish.trailHistory;
  const pool = fish.trailHistoryPool ?? (fish.trailHistoryPool = []);

  for (let i = startIndex; i < history.length; i += 1) {
    pool.push(history[i]);
  }
  history.length = startIndex;
}

function readTrailDirection(fish, target) {
  if (fish.velocity?.lengthSq() > 0.000001) {
    return target.copy(fish.velocity).normalize();
  }

  return target.copy(DEFAULT_FORWARD);
}

function readMaxTrailHistoryLength() {
  return (
    fishConfig.ribbonLength *
    Math.max(1, fishConfig.ribbonHistoryLengthScale ?? 1) *
    Math.max(1, fishConfig.visualScale ?? 1)
  );
}

function readTrailHistorySampleSpacing() {
  return Math.max(0.01, fishConfig.ribbonHistorySampleSpacing ?? 0.12);
}
