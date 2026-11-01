# Working in this repository

- Runtime: Node 26.13.0, npm 11.20.0, ESM, npm workspaces. Use `npm ci`.
- Run: `npm run dev` (web :5173, API :3000). Default Mock + Local needs no keys.
- Verify: `npm run check`, `npm run build`, `npm run test:e2e`, `npm run contracts:check`.
- Testing constraint: During local debugging and feature development, do not run functional tests, E2E tests, or runtime tests unless the user explicitly requests them. This also applies to aggregate commands such as `npm run check` when they execute these tests.
- `packages/protocol/src/index.ts` is the network contract source. Keep schemas strict, validate unknown input, regenerate OpenAPI after changes.
- `apps/web` owns UI and browser side effects. `apps/server` owns sessions, Graph, providers and private media. Neither imports the other; protocol imports neither.
- One valid turn per session. Every asynchronous side effect must check its identity. A stale cancel/finally cannot cancel a newer turn.
- Only the playback scheduler controls audio, captions, gestures and presentation receipts. `reply.done` is generation completion, never proof of presentation.
- Photo/environment facts require their own successful presentation receipts. Freeze receipts at cancellation. Model output never controls URLs or identifiers.
- Keep secrets and recorded user audio out of source, logs, browser bundles and test reports. Live does not silently fall back to Mock.
- Live uses Deepgram STT + GPT planning + Deepgram TTS. ProviderSet composes separate stt/planner/tts interfaces; UI follows session.capabilities.voiceInput. Do not restore removed CF speech settings.
- `npm run providers:probe -- --stage capabilities` is offline. Named stt/plan/tts probes are explicit external calls in Live; never run them in CI. All planner probes must stay inside LangGraph.
- Add meaningful race/contract tests when changing lifecycle or provider boundaries. Do not call paid providers in CI.
- Read [docs/README.md](docs/README.md) for design scope and [acceptance](docs/acceptance/implementation-plan.md) for delivery status.

- Character rendering is Live2D: `apps/web/src/scene/live2d*.ts`; pinned local runtime/model/terms live in `apps/web/public/assets/live2d`. Run `npm run assets:check` after asset changes. Keep Haru stand-in attribution; the removed SVG character and Rive paths must not reappear as silent fallbacks.

- Scenario logic lives in `apps/server/src/scenario/cafe/` as Ink and validated JSON. `runtime/` adapts inkjs; SessionManager alone commits receipt-confirmed checkpoints. Do not restore production keyword routing or duplicate prop canon in the frontend.
- After editing `.ink` or scenario JSON, run `npm run scenarios:build`; `npm run scenarios:check` validates the artifact. Generated `compiled.json` is ignored and rebuilt by dev/typecheck/build preparation. Keep existing dev services running; do not launch them for debugging unless requested.
