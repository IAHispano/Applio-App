# Applio App

Voice conversion, realtime voice changing, speech synthesis, and model training in one desktop app.

[Download](https://github.com/IAHispano/Applio-App/releases) · [Documentation](https://docs.applio.org) · [Discord](https://discord.gg/wY7gmqTyEV) · [Support](https://ko-fi.com/iahispano)

## Install

Download a build for Windows, macOS, or Linux. Open Applio, select **Install / Repair**, and add a voice model to get started.

## Development

Requires Git, Node.js 22+, pnpm 11, Python 3.12, and FFmpeg.

```bash
git clone --recurse-submodules https://github.com/IAHispano/Applio-App.git
cd Applio-App
pnpm install
pnpm desktop:dev
```

Use `pnpm dev` for the browser UI, `pnpm build:all` to build, and `pnpm typecheck` to check types.

[MIT License](LICENSE) · [Terms of Use](TERMS_OF_USE.md) · Built on [Applio](https://github.com/IAHispano/Applio).
