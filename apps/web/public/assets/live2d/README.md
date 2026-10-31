# Pinned local Live2D assets

These are actual Cubism model/texture/runtime files copied from this project's verified exploration. All network loads during rendering stay on the app origin. Run `npm run assets:check` from the repository root to validate published hashes and references.

- Model: official Haru sample, CubismWebSamples 4-r.7, commit de9eb4bec4326b81fe67a54e84322fdc39bc7446.
- Pixi: 6.5.10. Wrapper: pixi-live2d-display 0.4.0. Cubism Core reports 5.1.0 (numeric 83951616); exact bytes are pinned in SOURCES.json.
- Runtime model settings omit unused expression/motion/sample audio. No arbitrary model URL is accepted at runtime.
- Poster: transparent PNG rendered from this same model, only used for explicit failure fallback.
- See NOTICE.md and vendor/licenses for distinct code, Core and sample material terms. Nothing here is relicensed as original Mira artwork.

Original explorations remain local and are excluded from version control. Published assets are self-contained; their upstream sources, hashes and terms are recorded here and in SOURCES.json.
