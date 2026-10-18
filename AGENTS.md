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

For shared engine features and fixes, inspect both `backend/applio/app.py` and
`backend/applio/tabs/`, as well as the desktop web UI, Rust API, and Python
adapters. Keep controls, defaults, validation, engine parameters, saved settings,
and outputs consistent across the Gradio and desktop interfaces. A change in one
UI does not automatically reach the other. Trace each affected path and verify
both where possible; explicitly report any remaining parity gap.

Desktop-specific window, tray, installer, and native updater behavior belongs
in the desktop integration. When shared changes require editing the submodule,
account for its own translation files and track the engine revision/pin rather
than leaving uncommitted submodule changes that release checks will reject.

## Platforms and translations

Consider Linux, macOS, and Windows throughout implementation, not just the host
being used. Use portable paths and process APIs; account for file permissions,
native dependencies, audio backends, Linux Wayland/X11, and macOS Apple Silicon
and Intel where relevant. Preserve CPU and supported accelerator paths. Verify
affected platforms when available and clearly state what remains untested.

For every new or changed user-facing string, use the appropriate i18n helper
and update all supported language dictionaries with actual translations. Keep
placeholders and formatting consistent; adding an English key or copying English
into other locales is not a completed translation. Desktop dictionaries live in
`assets/i18n/languages`; Gradio has its own in
`backend/applio/assets/i18n/languages`. Update the dictionaries for each affected
interface and reuse existing keys when their meaning matches.

## Verification

Run checks appropriate to the change. Review documentation-only changes for
accuracy, links, and formatting; they do not require rebuilding installers.
For application changes, use the relevant commands below:

```sh
pnpm typecheck
pnpm format:check
pnpm --filter @applio/web build
node --test scripts/check-realtime-audio.mjs scripts/check-settings-actions.mjs scripts/check-update-policy.mjs
python scripts/check-realtime-service.py
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
