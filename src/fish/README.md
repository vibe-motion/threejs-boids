# Fish Appearance Modules

This directory owns the fish visual layer that can be migrated to cone-based
branches without bringing along unrelated boids code.

- `cartoon.glb`: source fish model used by this appearance package.
- `config.js`: dimensions, colors, render bounds, and swim deformation tuning.
- `model-loader.js`: same-directory GLB loading, fallback cone geometry, material cleanup.
- `curve-deformation.js`: instanced shader attributes and body/tail wiggle.
- `motion-state.js`: per-fish visual state for bank, bend, swim phase, and swim drive.
- `pose.js`: velocity-to-orientation helpers and head pose calculation.
- `instanced-school-renderer.js`: public InstancedMesh creation, update, and disposal.

`../fish-renderer.js` remains the compatibility entry point used by the rest of
the app.
