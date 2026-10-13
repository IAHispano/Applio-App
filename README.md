# Applio App

Voice conversion, realtime voice changing, speech synthesis, and model training in one desktop app.

[Download](https://github.com/IAHispano/Applio-app/releases) · [Documentation](https://docs.applio.org) · [Discord](https://discord.gg/wY7gmqTyEV) · [Support development](https://ko-fi.com/iahispano)

## Install

1. Download the Windows installer, macOS DMG, or Linux AppImage/DEB from [Releases](https://github.com/IAHispano/Applio-app/releases).
2. Open Applio and select **Install / Repair**. The first run needs internet access to download dependencies and model weights.
3. Add a voice model in **Models**, then convert recordings in **Inference** or go live in **Realtime**.

Models, audio, and settings are kept in the app's data folder and preserved across updates.

### Bridge Mode (experimental)

Open **Settings → Bridge Mode → Start sharing** in the desktop app. Scan the QR code
with your phone or copy the private link to another computer. Name the browser, then
approve its matching code on the host. The remote browser can run inference, TTS,
audio separation and audio tools, view jobs, and download results using the host's models.
Setup, model management, training, plugins, settings and realtime stay on the host.

The host must remain awake with Applio running. No shared network, router setup or
Cloudflare account is required. The first start downloads a pinned, SHA-256-verified
`cloudflared` helper from Cloudflare's official GitHub release into Applio's cache.
Windows x64/ARM64, macOS Intel/Apple Silicon, and Linux x64/ARM64 are supported
(Windows ARM64 uses the x64 helper).

Traffic travels through Cloudflare's HTTPS relay; this is not end-to-end encryption
between the two devices. Temporary Quick Tunnels have no uptime guarantee, a changing
hostname, a 100 MB upload limit and no SSE support (job updates fall back to polling).
Use this feature for personal, temporary access. See
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Invitations expire in ten minutes; **New invitation** invalidates the previous link.
Pending requests expire in five minutes, and approved sessions expire in eight hours.
Credentials stay in secure HttpOnly cookies and host memory, and are never sent to the
backend. Approve only your own browsers. On a borrowed computer, use **Disconnect**
before leaving. You can also revoke a device on the host. **Stop sharing**, quitting
Applio, or a tunnel failure invalidates every session and closes active connections.
Starting again requires fresh invitations and approvals; devices are not remembered.
If a fresh link does not open, wait for DNS propagation or try your phone's mobile
data connection. Applio checks public reachability before displaying the invitation.

Run `pnpm --filter @applio/desktop test:bridge` to check pairing, expiry, revocation,
proxy isolation and host-only capabilities. Set `APPLIO_BRIDGE_TUNNEL_SMOKE=1` to
also run the optional internet tunnel check, which exposes only synthetic test data.

## Features

- **Inference:** convert a single recording or run batches across files and models.
- **Realtime:** stream from your microphone with live settings.
- **Training:** preprocess a dataset, extract features, train, and build an index.
- **Tools:** download and inspect models, blend checkpoints, synthesize speech, and separate audio.

### Inference performance

File inference, batch conversion and TTS voice conversion use an app-owned
adapter around the pinned engine. It reuses one unchanged FAISS index within a
256 MiB cache budget, bounds neighbor-vector gathers to 256 frames, and
materializes the loaded decoder's fixed weight parametrizations once. Index
changes invalidate the cache; disabling retrieval or unloading the model releases it.
CUDA allocations remain reusable between chunks and are released during model cleanup.

Autotune uses vectorized nearest-note matching. Long-file cut selection uses a
linear-time rolling sum, and split-audio merging allocates the output once while
preserving gaps and converted-chunk timing. Exact index matches and missing
neighbors produce finite retrieval results. Model precision and voice controls
keep their existing behavior. The standalone engine submodule is unchanged.

Run `python -m unittest discover -s tools/tests` in the installed engine environment
and `pnpm --filter @applio/api test:inference` for regression checks. To compare
both pipelines with your own local weights and synthetic audio:

```bash
python tools/benchmark_inference.py --model logs/voice/voice.pth --index logs/voice/voice.index --runs 7 --report benchmark.json
```

The benchmark warms both pipelines, alternates their execution order, and
synchronizes GPU timing. It checks output parity with deterministic convolutions,
then measures with normal runtime flags. Model loading and file export are excluded.
Results depend on the selected model, pitch method, hardware and input duration.

### Dataset quality review

In **Training → Dataset quality review**, choose a training folder and scan it.
The review detects identical decoded recordings (including lossless files with
different formats), samples at/near full scale, excessive silence, and recordings
whose active RMS level differs by at least 6 dB from the dataset median. Findings
include timestamps you can click to audition the affected sections. The silence
threshold is adjustable; these checks are heuristics, not a voice-quality score.

Exclude individual clips or duplicates, then **Prepare training copy**. Optional
repairs trim silent edges while preserving interior pauses, balance active levels
toward -20 dBFS, or lower peaks to -1 dBFS. Existing clipping distortion cannot be
recovered. Repaired files become 24-bit WAV; untouched files keep their format.
Original recordings are never edited. The copy is published only after every
selected recording passes its source-change check. Choose **Use this dataset for
training** to select the new folder under `assets/curated-datasets`.

Reviews cover up to 5,000 recordings per folder and four hours per recording.
Symbolic links are skipped. Additional compressed formats use the existing FFmpeg
installation. Progress and cancellation use the app's job system.

### Realtime hardware calibration

Select a model and **Start Streaming**, then use **Hardware calibration**. Speak
continuously with headphones for about 45 seconds while the app tests 40, 80, 120,
200, 360 and 640 ms buffers. It waits for engine acknowledgment, discards warmup,
and measures p95 processing/round-trip times, dropped capture blocks and playback
gaps. Your original buffer policy is restored after testing or cancellation.

Only candidates with enough active input/output replies, processing headroom, no dropped blocks,
and at most 30 ms playback underrun are recommended. Silence is inconclusive.
Choose **Apply recommended buffer** to use the smallest stable candidate. Changing
model/device/voice settings invalidates the recommendation. Results describe the
short measured session and do not guarantee stability under future load; there is
already an automatic chunk-size warmup option for ordinary startup.

Tests: `python -m unittest discover -s tools/tests`,
`pnpm --filter @applio/api test:dataset-review`, and
`pnpm --filter @applio/web test:calibration`. Use the app's Python environment for
the audio tests (`PYTHON_BIN` can override the API test's interpreter).

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
