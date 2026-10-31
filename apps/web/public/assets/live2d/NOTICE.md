# Live2D runtime and character notices

This application uses the official **Haru** sample as a technical stand-in. Haru is not original Mira artwork. The original Mira model and a dedicated photo-offering hand animation have not been supplied.

This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion.

## Runtime

- PixiJS 6.5.10 — MIT; `vendor/licenses/pixi-MIT.txt`.
- pixi-live2d-display 0.4.0 — MIT; `vendor/licenses/pixi-live2d-display-MIT.txt`.
- Live2D Cubism Core — copyright Live2D Inc.; proprietary redistributable code, not MIT. `vendor/licenses/Live2D-Proprietary.html`.
- Wrapper Cubism components retain the upstream framework terms: `vendor/licenses/Live2D-Open-Software.html`.

This deliberately reuses the pinned, browser-verified combination from the project exploration. The exact local files and upstream URLs are identified by SHA-256 in `SOURCES.json`. They load from this application's own origin; no production CDN dependency is used.

## Character

Haru model source: https://github.com/Live2D/CubismWebSamples/tree/de9eb4bec4326b81fe67a54e84322fdc39bc7446/Samples/Resources/Haru

Terms: `vendor/licenses/Live2D-Free-Material.html`, `vendor/licenses/Live2D-Sample-Terms.html`, `vendor/licenses/CubismWebSamples-LICENSE.md`.

Artwork/moc3/textures/physics/pose are unchanged. The runtime model manifest omits unused motion and expression groups, and includes no sample voices. `haru/Haru.source.model3.json` preserves the upstream manifest. The application drives only verified parameters and owns the single audio playback pipeline.

The cached fallback poster is a frame of this same Haru model, generated for loading failure/hidden-page recovery. It is subject to the same sample-material terms; it is not a replacement animation or original artwork.

The café background is an existing project exploration asset. Live2D SDK release rights, sample-model usage rights and application-source rights remain separate. Before a public commercial release, review the applicable release entity/use case at https://www.live2d.com/en/download/cubism-sdk/release-license/ and replace the technical stand-in with an appropriately licensed final character.
