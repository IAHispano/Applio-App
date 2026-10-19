# Applio App

Voice conversion, realtime voice changing, speech synthesis, and model training in one desktop app.

[Download](https://github.com/IAHispano/Applio-App/releases) · [Documentation](https://docs.applio.org) · [Your data & privacy](YOUR_DATA.md) · [Discord](https://discord.gg/wY7gmqTyEV) · [Support](https://ko-fi.com/iahispano) · [Patreon](https://www.patreon.com/iahispano)

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

Use `pnpm dev` for the browser UI, `pnpm check` for regression checks,
`pnpm typecheck` to check types, and `pnpm format:check` to check formatting.

Build installers with `pnpm build:win`, `pnpm build:mac`, or `pnpm build:linux`
on the corresponding platform.

[MIT License](LICENSE) · [Terms of Use](TERMS_OF_USE.md) · [Security Policy](SECURITY.md) · Built on [Applio](https://github.com/IAHispano/Applio).
