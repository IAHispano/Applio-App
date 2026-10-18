# 1.0.2 release check

Checked on October 18, 2026. Application changes are in `7d5ac32f`;
installer startup checks are in `a2a21b8e`.

All four CI jobs completed successfully.

[Validation run and downloadable installers](https://github.com/IAHispano/Applio-App/actions/runs/39141682265)

## Changes reviewed

Reviewed commits after `v1.0.0` and `v1.0.1`, plus the pending desktop fixes.
The speculative realtime warmup was a release blocker: it could load GPU models
without a scheduler lease and overlap the live connection's CUDA capture.
It has been removed. Model caching remains; loading and warmup happen through
the normal connection handler after the API acquires the realtime lease.

The fixes also cover AppImage media bundling, download fallback actions,
Voice Focus audio routing and microphone constraints, realtime shutdown and
orphan recovery, Settings restart/quit, close-to-tray, optional updates with
version-specific deferral, commit-linked release notes, and Discord support.

## Automated verification

- Local workspace TypeScript and Rust checks: passed.
- Local formatting checks: passed with seven existing unused-code warnings.
- Ten JavaScript regression tests: passed locally and in CI.
- Four Python realtime initialization/cache tests: passed locally and in CI.
- Native API regression tests: two passed on Windows; three passed on Unix,
  including recordless orphan discovery and port release.
- Production web export: all 18 pages passed.
- Local download fallback probe: repeated clicks each emitted a unique toast,
  HTTP fallback opened the output URL, and temporary audio was captured for preview.
- Windows NSIS installer: built locally; release executable loaded its native
  WebView, served the exported interface, and restarted to a new API generation.
- Linux AppImage and Debian package: built in CI. Required GStreamer plugins,
  scanner, and AppRun hook verified. AppImage launch, native WebView readiness,
  exported UI, and API restart passed under a virtual display.
- Apple Silicon DMG: built and mounted in CI. Packaged application launch,
  native WebView readiness, exported UI, and API restart passed.
- Intel Mac DMG: built and mounted in CI. Packaged application launch,
  native WebView readiness, exported UI, and API restart passed.
- Isolated `1.0.2` release preparation: all package, config-template, Tauri,
  workspace Cargo, and Cargo lockfile versions synchronized correctly.
- Optional update tests confirm that automatic checks do not download or
  install, deferral persists for one release, Settings bypasses deferral,
  and release notes and the updater feed contain matching commit links.

Validation installers retain the current `1.0.1` source version. The release
workflow sets `1.0.2` before building signed updater artifacts. Validation does
not publish a release or use the signing secret.

## Hands-on acceptance still required

Automated startup checks do not establish audio or GPU behavior on the affected
hardware. Before final release sign-off:

- On the reporting Mac M4/macOS version, stream real microphone audio with
  Voice Focus Off, C20, C50, and C100; change modes while streaming and verify
  output, background noise behavior, and repeated stop/start cycles.
- On CachyOS/KDE Wayland, launch the AppImage with the user's normal environment;
  play output audio and download it. Repeat under X11 if supported.
- Start realtime after training/inference and return to training afterward;
  confirm GPU ownership and recovery with actual models and accelerator hardware.
- Exercise audio, model, analyzer, and batch download buttons; verify each click
  shows the Open file fallback and that temporary blob previews remain usable.
- Close the window while idle and while streaming, reopen from the tray, then
  use Settings Quit and tray Quit; confirm exit and realtime port release.
- Test a signed update from the installed release: defer it, restart the app,
  reopen it from Settings, download, and explicitly install it. Confirm a newer
  subsequent release prompts again. Signing/install compatibility is not covered
  by unsigned validation builds.

No release has been published by this check.
