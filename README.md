# Applio App

Voice conversion, realtime voice changing, speech synthesis, and model training in one desktop app.

[Download](https://github.com/IAHispano/Applio-app/releases) · [Documentation](https://docs.applio.org) · [Discord](https://discord.gg/wY7gmqTyEV) · [Support development](https://ko-fi.com/iahispano)

## Install

1. Download the Windows installer, macOS DMG, or Linux AppImage/DEB from [Releases](https://github.com/IAHispano/Applio-app/releases).
2. Open Applio and select **Install / Repair**. The first run needs internet access to download dependencies and model weights.
3. Add a voice model in **Models**, then convert recordings in **Inference** or go live in **Realtime**.

Models, audio, and settings are kept in the app's data folder and preserved across updates.

## Features

- **Inference:** convert a single recording or run batches across files and models.
- **Realtime:** stream from your microphone with live settings.
- **Training:** preprocess a dataset, extract features, train, and build an index.
- **Tools:** download and inspect models, blend checkpoints, synthesize speech, and separate audio.

## Development

Requires Git, Node.js 22+, pnpm 11, Python 3.12, and FFmpeg.

```bash
git clone --recurse-submodules https://github.com/IAHispano/Applio-App.git
cd Applio-App
pnpm install
pnpm desktop:dev
```

For browser-only development, run `pnpm dev` and open `http://localhost:3000` (API on port 8000).

```text
frontend/web/      Interface
frontend/desktop/  Electron shell and installers
backend/api/       API, setup, and job orchestration
backend/applio/    Standalone engine (Git submodule)
```

| Command | Purpose |
| --- | --- |
| `pnpm dev` | API and browser UI with hot reload |
| `pnpm desktop:dev` | API, UI, and Electron |
| `pnpm build:all` | Build all packages |
| `pnpm typecheck` | Check TypeScript |
| `pnpm format` | Format and lint |

Commit engine changes inside `backend/applio`, then update the parent submodule pin.

## License and responsible use

Application source is [MIT](LICENSE). Dependencies and downloaded model weights keep their own licenses. Use voices and recordings only with appropriate rights and permissions, per the [Terms of Use](TERMS_OF_USE.md).

Built on [Applio](https://github.com/IAHispano/Applio) and [rvc-cli](https://github.com/blaisewf/rvc-cli). Thanks to our [contributors](https://github.com/IAHispano/Applio-app/graphs/contributors).
