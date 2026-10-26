# Runtime asset preparation

This optional, isolated toolchain regenerates the committed game-ready GLBs from
the untouched source files in `public/models/`. It is not installed or run by the
game server, browser build, or deployment.

```sh
cd tools/assets
pnpm install --frozen-lockfile
pnpm optimize
```

Node 22.12+ and pnpm are required. The package versions and lockfile are pinned.
The script uses [glTF Transform](https://gltf-transform.dev/modules/functions/functions/simplify)
with meshoptimizer to weld and simplify the mesh, then uses Sharp to resize the
original PNG/JPEG textures. No Draco, KTX, Meshopt compression, or runtime decoder
is required. The source material extensions are preserved.

| File | Triangles | File bytes | Maximum texture size |
| --- | ---: | ---: | ---: |
| `citizen-realistic.glb` (source) | 91,610 | 21,026,604 | Original |
| `citizen-optimized.glb` | 31,087 | 4,321,308 | 1,024 |
| `citizen-distant.glb` | 10,714 | 1,596,780 | 512 |
| `concept-car.glb` (source) | 213,347 | 11,778,688 | Original |
| `concept-optimized.glb` | 65,687 | 4,431,752 | 1,024 |

The two main optimized files together are 73.3% smaller than their source files.
The distant character is optional and intended for background pedestrians.

Each output is checked with the Khronos glTF Validator. All have zero errors.
Both character variants inherit 15 warnings from the source: three materials use
runtime-generated tangent space, and 12 skinned mesh nodes have parent nodes.
The car has no warnings. `asset-report.json` records exact metrics, input hashes,
texture dimensions, settings, and validation results.

The script asserts identical node names/hierarchy, material names, skin joint
references and inverse bind matrices, and complete animation channel data after
the transformations and a write/read round trip. Transform comparison allows
glTF Transform's removal of near-identity floating point noise. The character
retains 70 nodes, one skin and the original walk animation. The car retains all
101 nodes including `WheelFrontL`, `WheelFrontR`, `WheelRearL` and `WheelRearR`
and their rim, brake and tire children.

Simplification reduces very fine geometric details and 1K textures soften extreme
close-ups. The distant character is visibly coarser and should not be used for
the local player or close camera shots. Keep the original files for future
high-detail quality settings or reprocessing. See `../../THIRD_PARTY.md` for the
unchanged asset licenses and attribution.
