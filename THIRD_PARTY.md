# Third-party assets

These assets are bundled locally. No paid assets or GTA/Rockstar content are included.

## Sam — Walk carrying phone

- File: `public/models/citizen-realistic.glb`
- Creator: Innerscene, adapted from MakeHuman/MPFB CC0 body, rig and skin assets.
- Source: https://www.innerscene.com/tools/library/3d-parts/walk-carrying-phone-sam-3d-person-animated-241a2abe
- Download: https://www.innerscene.com/api/library/walk-carrying-phone-sam-3d-person-animated-241a2abe/download
- License: CC0 1.0 Universal. The source page expressly permits modification and redistribution.
- Runtime adaptations: height normalization, shirt recoloring, accessory hiding, animation speed changes and pistol attachment. The original embedded animation is an authored walk loop, not motion capture.
- Optimized derivatives: `citizen-optimized.glb` (31,087 triangles; 1K textures) and `citizen-distant.glb` (10,714 triangles; 512px textures), created with glTF Transform and meshoptimizer. Both preserve the original skeleton and walk animation. The source file remains unchanged.

## Car Concept

- File: `public/models/concept-car.glb`
- Copyright 2024 Darmstadt Graphics Group GmbH. Model and textures by Eric Chadwick, based on a public-domain concept car by Unity Fan.
- Source: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept
- License: Creative Commons Attribution 4.0 International.
- License details: `public/licenses/CarConcept.md`, `public/licenses/CC-BY-4.0.txt`.
- Runtime adaptations: scale, placement, paint recoloring and simplified glass. This is a concept car, not a licensed real-world vehicle brand.
- Optimized derivative: `concept-optimized.glb` (65,687 triangles; textures capped at 1K), created with glTF Transform and meshoptimizer. Node names, wheel hierarchy, material variants and original attribution are preserved. The source file remains unchanged.
- Khronos/3D Commerce logos remain subject to their trademark terms (`public/licenses/Khronos-Trademark.txt`). Attribution does not imply endorsement.

## Kloofendal 48d Partly Cloudy (Pure Sky) HDRI

- File: `public/environment/coastal-sky.hdr`
- Author: Greg Zaal and Jarod Guest / Poly Haven.
- Source: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- License: CC0 1.0 Universal. https://polyhaven.com/license
- Used for sky and physically based reflections; displayed exposure changes during play.

## Libraries and fonts

- Three.js: MIT, https://github.com/mrdoob/three.js
- Socket.IO and socket.io-client: MIT, https://github.com/socketio/socket.io
- Express: MIT, https://github.com/expressjs/express
- Vite: MIT, https://github.com/vitejs/vite
- Inter and Heebo fonts are requested from Google Fonts (SIL Open Font License); local system fonts are used if that service is unavailable. Fonts are not bundled in this repository.

The city layout, procedural architecture, lightweight traffic vehicles, UI, gameplay and synthesized game audio are original RP SMAI work. Full dependency license notices are available in the installed packages.

The optional asset preparation tools are isolated in `tools/assets/`: glTF Transform (MIT), meshoptimizer (MIT), Sharp (Apache-2.0), and Khronos glTF Validator (Apache-2.0). They are not browser or game-server runtime dependencies. Reproduction instructions and validation metrics are in `tools/assets/README.md` and `tools/assets/asset-report.json`.
