# Applio App

Voice conversion, realtime voice changing, speech synthesis, and model training in one desktop app.

[Download](https://github.com/IAHispano/Applio-App/releases) · [Documentation](https://docs.applio.org) · [Discord](https://discord.gg/wY7gmqTyEV) · [Support](https://ko-fi.com/iahispano) · [Patreon](https://www.patreon.com/iahispano)

## Install

Download a build for Windows, macOS, or Linux. Open Applio, select **Install / Repair**, and add a voice model to get started.

## Development

Requires Git, Node.js 22+, pnpm 11, stable Rust, Python 3.12, FFmpeg,
and the platform's Tauri prerequisites (MSVC C++ tools and WebView2 on Windows).

```bash
git clone --recurse-submodules https://github.com/IAHispano/Applio-App.git
cd Applio-App
pnpm install
pnpm desktop:dev
```

Use `pnpm dev` for the browser UI, `pnpm build:all` to build, and `pnpm typecheck` to check types.

The desktop shell uses Tauri 2. The API, job scheduling, setup, and Bridge Mode
run in Rust. Rust also serves the statically exported Next.js UI. Installed builds
include no Node runtime or Node service; Node is needed only for development and
build tooling. The voice engine remains Python.

Backend code is grouped by responsibility under `backend/rust-api/src/`.
App-owned Python helpers live in `backend/python/` (`inference`, `datasets`,
`downloads`, and `audio`); `backend/applio/` remains the pinned upstream engine.

Build installers with `pnpm build:win`, `pnpm build:mac` or `pnpm build:linux`
on the corresponding platform. Run `pnpm test:rust` and `pnpm release:check`
after staging release resources.

## Releases

In GitHub Actions, run **Build and Release** and enter the next version. The
workflow updates every app version automatically, then builds and tags that exact
commit. There is no need to edit version files manually.

The release workflow requires `TAURI_SIGNING_PRIVATE_KEY` and, for encrypted keys,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in GitHub Actions secrets. The key must match
the public identity in `frontend/desktop/src-tauri/tauri.conf.json`. Back it up
securely outside the repository. Local builds can use `APPLIO_SIGNING_KEY_FILE`
or `~/.applio-signing/updater.key`.

Publish the generated signed artifacts and updater feeds together. The Windows
installer supports the first Electron-to-Tauri transition while retaining user
data and Python; macOS Electron users need a manual first migration.

[MIT License](LICENSE) · [Terms of Use](TERMS_OF_USE.md) · Built on [Applio](https://github.com/IAHispano/Applio).
