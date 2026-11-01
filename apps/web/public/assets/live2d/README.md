# Pinned local Live2D assets

These are actual Cubism model/texture/runtime files copied from this project's verified exploration. All network loads during rendering stay on the app origin. Run `npm run assets:check` from the repository root to validate published hashes and references.

- Model: official Haru sample, CubismWebSamples 4-r.7, commit de9eb4bec4326b81fe67a54e84322fdc39bc7446.
- Pixi: 6.5.10. Wrapper: pixi-live2d-display 0.4.0. Cubism Core reports 5.1.0 (numeric 83951616); exact bytes are pinned in SOURCES.json.
- Haru runtime model settings omit unused expression/motion/sample audio. No arbitrary model URL is accepted at runtime.
- Poster: transparent PNG rendered from this same model, only used for explicit failure fallback.
- See NOTICE.md and vendor/licenses for distinct code, Core and sample material terms. Nothing here is relicensed as original Mira artwork.

Original explorations remain local and are excluded from version control. Published assets are self-contained; their upstream sources, hashes and terms are recorded here and in SOURCES.json.

## Additional model staged for integration

`miara/` contains the Miara sample runtime model, texture, physics, parameter information and three original motions. These eight files are pinned byte-for-byte to a public mirror; see [Miara asset notes](miara/README.md) and the `additional_models.miara` record in `SOURCES.json`. The editor source project is not included. Miara is staged only; Haru remains the current character and its resources are preserved. No additional runtime library or sample audio is introduced.

The implementation handoff is `docs/prompts/miara-webgal-implementation.md` in the repository.
