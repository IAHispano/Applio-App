# Tauri and Rust migration

The desktop shell is Tauri 2. The API and engine orchestration run in Rust/Axum,
shared by the desktop executable and the standalone `applio-api` binary.
The Node API and private Node integration host have been removed. Node is bundled
only for the retained Next.js UI. The Python voice engine is retained.

## Runtime

```text
Tauri / Rust
  ├─ window, grouped tray, shortcuts, clipboard, dialogs, notifications, updater
  ├─ Axum API: 127.0.0.1:8000
  │   ├─ jobs, SSE, GPU scheduling, inference worker, uploads and downloads
  │   ├─ models, conversion, batch, TTS, blending, audio tools and UVR
  │   ├─ training, dataset review, TensorBoard, plugins and reports
  │   └─ settings, storage, setup, GPU prerequisites and Python supervision
  ├─ native Bridge Mode gateway, pairing and owned Cloudflare tunnel
  └─ Next.js UI: 127.0.0.1:3000 (the only Node service)
```

All 92 method/path entries in [the captured API inventory](api-route-inventory.json)
are mounted by the native router. Unknown routes return 404. There is no fallback
API service, private compatibility port, token, or IPC host. The health response
identifies `runtime: "rust"` and `compatibilityService: false`.

The main window's exact loopback origin receives native capabilities. Public
Bridge Mode pages do not receive them. Pairing requires local approval; sessions
expire and revocation interrupts active downloads. Remote capabilities are
restricted by a native allowlist. Helper downloads are checksum pinned.

Workers use Windows kill-on-close Job Objects or Unix process groups. Cancellation
and shutdown stop descendants before releasing GPU leases. API generations retain
the listening socket while jobs, services and history drain before restart.

## Storage and upgrades

Windows installed builds keep writable content in `data` beside the executable:
`runtime`, `cache`, `temp`, `session`, `app-logs`, managed Python and tools.
An actual write probe detects unwritable installations. Other platforms retain
their application-support/config directories. Development supports `APPLIO_ROOT`
and `APPLIO_CONFIG_DIR` overrides. Per-runtime environment maps avoid mutating the
process environment while work is running; `.env` values never override explicit
environment variables.

Existing Windows installation/AppData content is copied before seeding. Settings,
history, model files, assets and training paths are imported without deleting
originals or overwriting content already present. Large model files stream through
staging files. External configured folders remain external. Python environments
are installed locally rather than copied from an unrelocatable old installation.
Imports are restartable and marked complete only after successful publication.

Shipped engine tools and requirements refresh on upgrades; user assets, models
and plugins are retained. Settings and job snapshots publish atomically. Model
folder moves use a verified transaction journal with recovery and rollback.
Tauri's window state is stored in the application data directory.

Installed automatic updates require the configured Tauri signing key/public key
and signed release feed. Unsigned local builds produce an installer and retain
manual update behavior. Development source updates require a clean working tree,
no active jobs and a fast-forward pull; installed binaries use release installers.

## Build and verification

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm dev                 # Rust API plus browser UI
pnpm build               # standalone API and Next.js production build
pnpm build:win           # Windows NSIS installer
pnpm build:mac           # run on macOS
pnpm build:linux         # run on Linux
pnpm typecheck
pnpm test:rust
node bin/cargo.mjs clippy --workspace --all-targets -- -D warnings
pnpm runtime:check       # production Next.js output must exist
pnpm release:check       # staged resources must exist
pnpm desktop:check       # Windows WebView2 smoke check
node bin/check-desktop.mjs --release
pnpm storage:check
```

The Rust suite includes native HTTP/SSE/WS contracts, golden parameter/CLI
comparisons, process-tree cancellation, resource contention, upload/range
streaming, download resumption, setup/install fixtures, data migration, source
updates, Bridge pairing/revocation and tunnel lifecycle. Contract/schema JSON
snapshots preserve the original API behavior independently of the deleted Node
implementation. The inventory test checks mounting; behavioral checks are separate.

Four optional integration checks require network or an installed voice environment.
On PowerShell, select the retained voice Python environment and run the three
Python integrations (dataset scan/prepare, TensorBoard, realtime control):

```powershell
$env:APPLIO_ENGINE_TEST_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
node bin/cargo.mjs test -p applio-api real_python -- --ignored --nocapture
node bin/cargo.mjs test -p applio-api real_tensorboard -- --ignored --nocapture
node bin/cargo.mjs test -p applio-api real_pinned_helper -- --ignored --nocapture
```

These integrations use isolated data and loopback ports. The helper check verifies
its actual pinned download and version without opening a public tunnel. They do
not establish live microphone/GPU conversion or training quality. macOS/Linux
installers, real GPU setup and installed in-place upgrades need tests on the
corresponding platforms and devices. Native notifications depend on OS click
reporting; Windows reports clicks while the toast is displayed.

## Local verification (Windows, 2026-10-15)

- Default Rust suite: 147 passed; four optional integrations skipped by default.
- All four optional integrations explicitly run: four passed.
- Workspace type checking, Clippy with warnings denied, and Rust formatting passed.
- Standalone development and staged release API/UI startup checks passed.
- Actual development and packaged release WebView2/native-bridge checks passed;
  both reported Rust runtime with `compatibilityService: false`.
- Windows NSIS build completed; installer collected at
  `frontend/desktop/dist-installers/Applio_0.2.9_x64-setup.exe` (167,012,580 bytes).
- Staged resources contain the Python engine and Next.js UI, with no Node API
  bundle or compatibility host. The generated uninstaller enumerates shipped
  resources and leaves the installation-local `data` directory intact.

Live microphone/GPU conversion, macOS/Linux builds and in-place installed upgrade
behavior were not exercised by these checks.

## Upstream integration (2026-10-15)

Pulled `origin/main` through `33a7cac5` and updated the clean Python submodule to
`67a38f6a`. The upstream UI, Patreon links and translations are retained. Rust
inference/TTS/batch schemas now strip the removed cleaning and post-processing
FX options; CLI arguments and golden references match the new engine. Training
preprocessing omits the retired noise-reduction and strength arguments. Formant
settings remain supported in conversion and realtime configuration/transport.
The app-owned Python CLI adapter no longer passes removed engine keywords.

The updated i18n extractor retains upstream AST rules, uses explicit native job,
stage and tray carriers, normalizes Windows paths and prunes without an external
`grep` dependency. Native job labels are translated in all 15 locales. Inventory
checks and a temporary-dictionary prune test passed; sync dry run reports no
missing entries and no unresolved extraction sites.

All 147 default Rust checks plus four optional integrations passed against the
new pin. Actual Python preprocessing with its new nine-argument CLI produced a
sliced WAV and preserved the source audio. Type checks, Clippy, formatting,
packaged runtime startup and the release WebView2 check passed. The latter also
opens Realtime, enables formant shifting and verifies that both new sliders
appear while the retired FX controls are absent. The Windows installer was
rebuilt and collected. The migration safety stash remains available.

## Restored startup screen

The original Syne wordmark, white animated loading bar, radial glow and perspective
grid are restored from the former Electron splash. A frameless 1140×640 Tauri
window stays visible until the main UI has finished loading. Both windows share
compatible WebView2 settings; the splash is excluded from saved window state.
The font is staged from the existing brand asset during the Rust build.

Startup errors retain the artwork and expose a retry button. The splash receives
only local startup/event/drag permissions. Closing it exits the application and
stops its owned services. `node bin/check-desktop.mjs --startup-retry --snapshot`
checks the real failure/retry/handoff flow, font, artwork and native permission
boundary, and saves `.applio-dev/splash-preview.png` for visual inspection. The
same check supports `--release` for packaged builds.

The restored splash passed both development and packaged-release WebView2 checks, including startup failure, retry, font loading and destruction after the main UI loads. Clippy and formatting passed; the Windows installer includes the restored screen.

## Desktop browser controls

Both native windows disable DevTools and inject a shared keyboard/context-menu
policy before page scripts load. On Windows, WebView2 also disables DevTools,
browser accelerators and default context menus through its native settings.
The policy blocks F12, inspector/console shortcuts, source viewing, reload,
print/save/open, browser find, tab/window commands and browser history shortcuts.
Copy, cut, paste, select-all, undo/redo, ordinary navigation and app controls remain
available. Browser-hosted Next.js and remote Bridge pages do not receive this
native-window policy. WebView2 smoke checks cover blocked commands, context menus
and preserved editing shortcuts alongside normal startup and retry.

Browser command blocking and preserved editing shortcuts passed the development and packaged release WebView2 checks. The rebuilt Windows installer includes this policy in both native windows.

## Desktop cleanup and idle work

Tray updates load one language selection and dictionary per menu rebuild instead
of rereading and parsing both files for every label. The tray and Bridge Mode
share the same locale validation and dictionary fallback. Settings are read on
each operation so changing language does not require restarting the application.
Realtime state is copied before native menu creation, keeping its mutex free
while platform menu calls run.

The startup page-load callback now signals a Tokio notification, replacing the
50 ms readiness polling loop. Notifications retain a permit when page load
finishes before the waiter is registered, including startup retries. The desktop
crate also drops unused direct dependencies on serde, uuid, libc and windows-sys;
dependencies needed by other workspace crates remain.

The desktop smoke check exercises disconnected, connecting, streaming, muted and
monitoring tray states, then clears the snapshot, in addition to startup failure,
retry, splash handoff, browser controls and the native bridge. The original
benchmark results remain a historical snapshot of the binaries identified by
their hashes; these cleanup changes do not establish new performance numbers.

Validation: workspace Clippy with warnings denied, Rust formatting, 147 enabled
Rust tests (four optional integrations skipped), and both debug and packaged
WebView2 startup/retry checks passed with the expanded tray-state coverage.

## Dashboard responsiveness and realtime tray reports

Dashboard sections publish their responses independently. Online version checks
run separately from local loading and the Refresh button. Refresh and navigation
cancel obsolete dashboard requests; manual refresh reads current API values.
Setup errors now reach the homepage's connection error and retry UI. Setup
responses are ordered so an older check cannot overwrite a newer result, and
forced checks bypass the frontend cache even when repeated within thirty seconds.

Recent activity polling waits for each response before scheduling another poll,
pauses new polls while hidden, resumes when visible, and cancels on navigation.
Realtime tray integration is isolated in `useRealtimeTray`. Controls report
changes immediately, changing timings are sampled once a second, and unchanged
snapshots send a five-second heartbeat within the native ten-second freshness
window. Active audio processing continues independently of page visibility.

Run `node bin/check-desktop.mjs --dashboard --startup-retry` (optionally with
`--release`) against a production UI build. The check injects fixtures into its
own isolated window to hold update requests open, fail setup, recover through
Retry, and repeat a forced check after a cached success. It also instruments the
test bridge to verify idle heartbeat frequency and immediate monitor updates.
Fixtures are test-only and are not part of the shipped UI.
