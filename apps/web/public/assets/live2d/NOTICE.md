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

## Miara resources staged for integration

`miara/` also contains sample data © Live2D Inc., subject to the same Live2D Free Material License Agreement and Live2D Cubism Sample Data Terms of Use in `vendor/licenses/`. Miara is not original Mira artwork. It is staged for future WebGAL integration and does not replace or remove Haru.

Official model page: https://www.live2d.com/en/learn/sample/miara/

The eight runtime files were obtained from the public `xShiroeNguyenx/desktop-companion` mirror at commit `25ee0a10a2b5633a7e2c8714b108e6f68cd946da`, which attributes these sample models to Live2D Inc. The files are unchanged from that mirror; their individual source URLs and SHA-256 hashes are in `SOURCES.json`. The official ZIP was unavailable at retrieval, so no independent original-package checksum verification is claimed. The mirror application's source license does not relicense the Miara model.

This copy includes three original motion files but no sample voices, separate expression files or `.cmo3` / `.can3` editor project. It reuses the existing applicable runtime/material terms; future product integration must continue to keep one controlled audio pipeline.
