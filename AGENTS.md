# Repository guidance

## Project layout

- `frontend/web`: Next.js/React interface, exported as static files for desktop.
- `frontend/desktop/src-tauri`: Rust/Tauri shell, native bridge, tray, and updater.
- `backend/rust-api`: Axum API, job scheduling, process management, and setup.
- `backend/python`: adapters and workers for the Python engine.
- `backend/applio`: pinned upstream Applio submodule containing both the Python
  engine and the Gradio UI (`app.py`, `tabs/`). It is not an engine-only package.
  Prefer repository-level adapters for desktop integration; change the pin only
  when intentionally updating the engine or shared functionality.
- `assets/ecosystem.json`: official project links. `assets/i18n/languages`:
  translation dictionaries, with `en_US.json` as the key authority.

The desktop execution path is React → same-origin Rust API → scheduler/job →
managed Python worker or CLI → pinned engine. The Gradio path is
`backend/applio/app.py` → `tabs/` callbacks → `backend/applio/core.py` → engine.
The root `core.py` is a separate desktop CLI adapter that loads the pinned core
and adds app integrations; do not confuse the two files.

Production serves exported HTML through `backend/rust-api/src/runtime/web_host.rs`;
it has no Next.js server. Development uses the rewrites in
`frontend/web/next.config.ts`. New web pages must also be reachable through the
Rust host and navigation; do not introduce production Next.js server routes or
server-only runtime dependencies for an API that belongs in Rust.

## Development

Use Node.js 22+, the pnpm version in `package.json`, stable Rust, Python 3.12,
FFmpeg, and the native Tauri prerequisites for the host platform.
Run commands from the repository root unless stated otherwise.

```sh
pnpm install --frozen-lockfile
pnpm backend:init
pnpm desktop:dev
```

`pnpm dev` runs the API and browser interface. Use `node scripts/cargo.mjs`
for Cargo commands so the repository's Rust environment setup is applied.
Release builds require the backend submodule to match its pin and have no
uncommitted source changes; do not bypass `pnpm backend:check` to ship a build.

Keep changes focused and preserve existing user work. Reuse shared UI components
and helpers. Avoid adding dependencies or standalone scripts when existing code
can handle the task. Keep README concise; do not commit temporary investigation
notes, release-check reports, generated resources, models, or local user data.
Retain licenses and third-party attribution files.

Do not introduce or publish `docs/`, `test/`, `tests/`, or extra `scripts/` files
as byproducts of a task. Use existing checks and keep exploratory probes and
scratch documentation local. Maintain existing build and CI scripts when they
are needed; reuse them instead of creating parallel tooling.

Write clean, readable code with clear names and focused functions. Remove dead
code and unused imports in the code being changed. Add comments when they explain
a non-obvious decision, platform constraint, or invariant; avoid comments that
merely repeat the code, commented-out implementations, and speculative TODOs.

## Gradio and desktop parity

Read the relevant feature end to end before editing. Use these starting points;
trace their imports and call sites rather than assuming this list is exhaustive.

| Feature | Gradio starting point | Desktop starting points |
| --- | --- | --- |
| Conversion and batch | `backend/applio/tabs/inference/inference.py` | `frontend/web/components/InferenceForm.tsx`, `BatchForm.tsx`, `ConversionParameters.tsx`; Rust `routes/processing_routes.rs`, `routes/batch_routes.rs`, `inference/infer_params.rs` |
| Text to speech | `backend/applio/tabs/tts/tts.py` | `frontend/web/components/TtsForm.tsx`; Rust `routes/processing_routes.rs` and the shared inference contract |
| Training | `backend/applio/tabs/train/train.py` | `frontend/web/app/train/page.tsx`; Rust `routes/training_routes.rs`, `training/training_params.rs`, `training/training_artifacts.rs` |
| Realtime | `backend/applio/tabs/realtime/realtime.py`, `backend/applio/tabs/realtime/main.js`, `backend/applio/rvc/realtime/client.py` | `frontend/web/components/RealtimeWorkspace.tsx`, `frontend/web/lib/realtime-*.ts`; Rust `routes/realtime_routes.rs`, `execution/realtime.rs`; `backend/python/realtime/service.py` |
| Settings and model presets | `backend/applio/tabs/settings/`, inference preset callbacks, `rvc/lib/user_config.py` | `frontend/web/app/settings/page.tsx`, `frontend/web/lib/model-presets.ts`; Rust `routes/settings_routes.rs`, `execution/engine_runtime.rs` |

Rust paths in this table are relative to `backend/rust-api/src`; component
filenames without a directory share the preceding component's directory.
The settings row's `rvc/` reference is inside the pinned submodule.

For a shared parameter or behavior change, follow this sequence:

1. Inspect the engine function signature, parser, and actual implementation.
   Check Gradio `.click()`/`.change()` input ordering and result bindings; adding
   a control without wiring the callback does not implement the feature.
2. Compare desktop controls and defaults, API payload names, Rust normalization,
   worker/CLI translation, and output handling. Preserve units, ranges, enum
   values, nullable/optional behavior, speaker IDs, and dependencies between
   controls. Verify disabled and unsupported states as well as the happy path.
3. Check single conversion, batch overrides, TTS reuse, model presets, resets,
   and saved realtime settings wherever they reuse the changed parameter.
   Keep both configuration templates aligned when their shared defaults change.
4. Exercise both entry paths with equivalent settings when available, checking
   actual engine arguments and results. Label controls being present separately
   from the engine accepting and applying them. State remaining parity gaps.

Existing capabilities and defaults can differ across interfaces. Investigate
the reason before aligning them; do not silently remove a desktop capability or
change audio defaults just to make the UIs look identical. Document intentional
differences briefly in the final change explanation.

Desktop-specific window, tray, installer, and native updater behavior belongs
in the desktop integration. When shared changes require editing the submodule,
account for its own translation files and track the engine revision/pin rather
than leaving uncommitted submodule changes that release checks will reject.

## Contracts and shared state

- Rust validates conversion/TTS using
  `backend/rust-api/src/inference/inference-schema.json`; training uses
  `training/training-schema.json`, and separation uses `routes/uvr-schema.json`.
  The latter two paths are relative to `backend/rust-api/src`. Update the relevant
  schema and serializer with the UI, not just TypeScript types. Preserve the
  inference `cliOrder`, Python argument names, and training argument formatting.
- Desktop conversion defaults live in `frontend/web/lib/useConversionParameters.ts`;
  model presets are persisted through `model-presets.ts` and the settings API.
  Compare these with the Rust schemas and Gradio values whenever defaults change.
- `backend/python/inference/runtime.py` selects the pinned worker/CLI and applies
  the optimized adapter. `worker.py` adapts the upstream worker AST and checks its
  converter import. When updating the submodule, verify these assumptions and
  the newline-delimited JSON protocol used by Rust `execution/worker.rs`:
  request IDs, readiness, logs, completion/error messages, and cancellation.
  Keep heavy ML imports lazy; unrelated utility commands must not load a model.
- Long operations return HTTP 202 with `jobId`; observe completion through the
  job API. Keep `execution/jobs.rs`, job routes, `frontend/web/lib/api.ts`,
  `useJob.ts`, and shared job components consistent. Preserve job history,
  progress/log events, stop behavior, and error details; a queued request is not
  a successful conversion. Prefer existing API helpers and cache invalidation.
- Use `ConfigStore` in Rust `execution/engine_runtime.rs` for desktop settings.
  Preserve template merging, existing user values, atomic writes, and the rule
  that installed package versions are not overridden by saved settings. Gradio
  uses `backend/applio/rvc/lib/user_config.py`; respect its environment overrides.
- Installed code, writable data, configuration, and model storage are separate.
  Follow Tauri `src/runtime.rs`, Rust `runtime/app_runtime.rs`, and `EngineRuntime`
  for their resolution. Reuse path validation and model-relative `logs/` aliases;
  do not derive data locations from the current directory or break moved model
  folders. Preserve transactional storage moves and legacy import behavior.

## Interface cohesion and native boundaries

Reuse `frontend/web/components/ui`, layout components, CSS theme tokens, and
shared conversion controls. Preserve keyboard access, labels, focus handling,
loading/error states, and the setup/terms guards in the root layout and AppShell.
Keep implementation details out of user flows unless they help a user decide.

`workspace-state.ts` holds session drafts; persisted preferences and model presets
have separate storage. Preserve that distinction. AppShell keeps realtime mounted
through `PersistentWorkspace` so navigation does not stop a stream; avoid extending
this to ordinary pages that would keep hidden polling or audio running. Release
streams, listeners, sockets, timers, and object URLs through their existing helpers.

`window.applio` is injected by Tauri `src/bridge.js` only for the local app origin.
Browser and remote Bridge pages do not have native IPC. Guard native actions and
maintain a usable browser path. A new native command must agree across its Rust
handler/registration, explicit permissions/capabilities, bridge method, and caller.
Do not broaden origin or navigation permissions to fix a UI bug.

For remote features, review both Rust `bridge/bridge_policy.rs` and
`frontend/web/lib/bridge-mode.tsx`. Host-only routes, authorization, allowed methods,
and streamed/polled updates are distinct from local desktop behavior; never expose
a privileged operation just because its local API exists.

## Platforms and translations

Consider Linux, macOS, and Windows throughout implementation, not just the host
being used. Use portable paths and process APIs; account for file permissions,
native dependencies, audio backends, Linux Wayland/X11, and macOS Apple Silicon
and Intel where relevant. Preserve CPU and supported accelerator paths. Verify
affected platforms when available and clearly state what remains untested.

Use Rust `execution/gpu_runtime.rs`, `execution/gpu-devices.json`, and
`setup/setup_requirements.rs` under `backend/rust-api/src` for GPU policy and
dependency selection. Compare upstream `rvc/configs/config.py` when changing
device support; do not duplicate accelerator detection or install a single
platform's Torch/ONNX dependencies unconditionally.

For every new or changed user-facing string, use the appropriate i18n helper
and update all supported language dictionaries with actual translations. Keep
placeholders and formatting consistent; adding an English key or copying English
into other locales is not a completed translation. Desktop dictionaries live in
`assets/i18n/languages`; Gradio has its own in
`backend/applio/assets/i18n/languages`. Update the dictionaries for each affected
interface and reuse existing keys when their meaning matches.

The desktop uses `useI18n()`/`translate()`; Gradio uses its own i18n loader. Include
tooltips, errors, empty states, accessibility labels, native tray/notifications,
and new option labels. Keep stable API enum values and configuration keys separate
from translated display text. The existing i18n extractor and sync tools help
check key coverage; English fallback entries do not prove translation completion.

## Verification

Run checks appropriate to the change. Review documentation-only changes for
accuracy, links, and formatting; they do not require rebuilding installers.
For application changes, use the relevant commands below:

```sh
pnpm typecheck
pnpm format:check
pnpm --filter @applio/web build
pnpm check
node scripts/cargo.mjs test -p applio-api --lib
```

Do not run Next.js type generation, development, and production builds against
the same output directory concurrently. Add regression coverage for meaningful
bugs, reuse existing checks, and keep workflow references in sync when moving
or removing scripts. Distinguish passing checks from warnings and untested paths.

## Runtime behavior to preserve

- GPU work must respect scheduler ownership. Do not load models or run
  speculative realtime warmup outside the realtime GPU lease.
- On stop, restart, or quit, cancel work and clean up owned child processes
  before releasing their resources. Never terminate a process based only on
  its name or an unverified saved PID.
- Preserve WebKit audio graph routing and microphone track cleanup. Test Voice
  Focus changes against the existing realtime audio checks; browser tests alone
  do not establish microphone behavior on macOS or Linux.
- Keep the local API on loopback and preserve Bridge authorization, validated
  native IPC commands, and narrow Tauri permissions.
- Updates are optional. Automatic checks must not download or install updates.
  Deferral applies to the chosen release, and Settings must still allow updating.
- Downloads must retain an Open file fallback, including temporary audio/blob
  previews. A requested download is not proof that a file was saved.
- Keep official links in the ecosystem configuration where applicable.

## Packaging and releases

Build native installers on their corresponding platforms using `pnpm build:win`,
`pnpm build:mac`, or `pnpm build:linux`. Preserve AppImage media bundling and
`node scripts/collect-tauri-artifacts.mjs --check-appimage-media` in Linux checks.

Keep development-only documentation, test folders, and build/verification scripts
out of published installers and runtime resources. Ship only runtime requirements,
required notices/licenses, and relevant product assets. Review resource staging
when changing dependencies or packaging so development folders do not leak in.

`frontend/desktop/scripts/stage-resources.mjs` controls the runtime resource set.
If an adapter, engine module, catalog, or runtime asset is added, confirm that it
is staged and its dependencies are installed by setup. Root `requirements.txt`
includes the pinned engine requirements; separation uses optional requirements
and setup's platform-specific dependency selection. Do not rely on packages
available only in the developer's global Python or Node environment.

The validation workflow builds unsigned installers and runs packaged Linux/macOS
startup checks. The release workflow changes versions, pushes a version commit,
builds signed updater artifacts, and publishes a release. Use validation for
testing; run the publishing workflow only when the user requests a release.
Let `scripts/sync-version.mjs` synchronize release versions instead of editing
one package version in isolation. Preserve updater signing identity and never
commit signing keys, credentials, or tokens.

State exactly which revision and platforms were tested. Installer compilation
and startup checks do not replace real microphone, audio playback, GPU, tray,
or signed-update testing. Do not describe those paths as verified without evidence.

Follow `SECURITY.md` for vulnerability handling. Keep vulnerability details out
of public issues and the Discord testers channel. Ordinary bug reports should
use the guided issue form with reproduction details and screenshot/video evidence.
