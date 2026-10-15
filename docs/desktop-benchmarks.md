# Desktop migration benchmarks

## Local results — 15 October 2026

Five measured runs per app after one discarded warmup, on Windows 11
10.0.26300, Ryzen 5 5600 (12 logical CPUs), approximately 32 GiB RAM.
Both packaged apps identify as Applio 0.2.9. These are **preliminary local
results**, comparing the previously installed Electron app with the current
uncommitted Tauri migration. [Raw samples and build identities](benchmarks/windows-2026-10-15.json)
include all process-tree measurements.

| Metric | Electron | Tauri + Rust |
| --- | ---: | ---: |
| Median main UI document load | 6.97 s | 1.72 s |
| UI document load range | 4.36–7.81 s | 1.65–1.91 s |
| Median idle private memory, whole process tree | 493.0 MiB | 384.0 MiB |
| Idle private memory range | 449.5–524.3 MiB | 352.1–518.3 MiB |
| Median summed working set | 578.5 MiB | 527.9 MiB |
| Median process count | 6 | 9 |
| Installed application files | 448.1 MiB | 449.5 MiB |

The medians show 75% shorter UI document load time and 22% lower private
memory in this setup-screen workload. Memory ranges overlap. The Tauri build
uses more processes, so process count alone is a poor proxy for resource usage.
Installed size is essentially unchanged. Its current installer is 167,012,580
bytes (159.3 MiB); a matching Electron 0.2.9 installer was unavailable, so no
download-size improvement has been established.

The old renderer reports Chromium 130.0.6723.137; the new WebView2 reports
Edge 155.0.4283.45. Next build IDs differ, and bundled engine revisions are
`c6fc349fee0e4886811425ff3d9e61cd1b32a3d5` (Electron) and
`67a38f6abab3e90a55efa534ea3185a222c102f0` (Tauri). The engine was not loaded
in these measurements. Browser age, application changes, background checks,
viewport and system activity can influence the comparison. These results do
not establish that Tauri itself produces these improvements on every machine.

A defensible description of this experiment is: “In our preliminary Windows
test, the new build loaded its UI sooner and used less median idle private
memory across the full application process tree. Five warmed launches per
build, no voice engine loaded.” Pair any numbers with the table and methodology;
repeat with matched release builds before using them as a general upgrade claim.

## What changed

The migration replaces Electron and the Node API with Tauri and Rust. Next.js
still runs in a bundled Node process, and voice conversion/training still run in
Python. The useful performance question is the cost of the complete application,
including its renderer, GPU process and services.

Electron distributes Chromium and Node with the app; Tauri uses the platform
WebView (WebView2 on Windows). This can reduce distribution overhead, but the
result depends on everything else the application ships. Runtime versions also
vary between machines with Tauri. See the [Electron introduction](https://www.electronjs.org/docs/latest/)
and [Tauri WebView reference](https://v2.tauri.app/reference/webview-versions/).

## Reproduce on Windows

Build the production Tauri application and stage its resources first. Retain an
installed Electron release in a separate folder. Close Applio so ports 3000 and
8000 are free, then run from the repository root:

```powershell
node bin/benchmark-desktop.mjs --electron "C:\path\to\Electron Applio" --runs 5 --output .applio-dev/benchmark-desktop.json
```

The harness copies both applications into disposable installations, excludes
existing user data and disables importing legacy data. It enables a local CDP
port only for these test processes, performs one discarded warmup per app, then
alternates launch order for five measured runs per app. Each app retains its
own isolated profile between runs. It kills only its own test process trees and
removes its temporary installations when finished. Keep the source applications
and raw JSON to reproduce a particular result; executable hashes and Next build
IDs identify the tested payloads.

Startup measures process spawn to API health success plus the main UI document
being loaded with meaningful text and a button. It does **not** measure React
hydration, first visible splash/window, or readiness of a loaded voice model.
Polling resolution is approximately 100 ms plus request time. OS caches are
warm and are not flushed.

After ten seconds, three samples of the complete process tree are taken two
seconds apart. Private bytes measure committed process memory, not physical RAM.
The summed working set is also reported, but shared pages can be counted more
than once. CPU uses deltas over this short sample window and should not be used
as a battery-life claim. Transient children between snapshots can be missed.

Installed size is the sum of logical application file sizes, excluding user
data and the uninstaller. It excludes the system WebView2 installation. The
current installer size is recorded separately; without the matching Electron
installer there is no download-size comparison.

These tests use `APPLIO_NO_ENV=1` with no Python environment or voice model
loaded. They measure the initial setup UI and desktop/API overhead. They do not
measure conversion throughput, realtime latency, training speed, GPU memory or
usage with a populated library. Both production UIs retain their normal
background checks, so network and system activity can contribute to variance.

## Publishing a comparison

The first local run compares an existing Electron installation against the
current migration. Different Next builds, engine revisions and browser versions
make this an exploratory application comparison, not proof of the isolated
effect of a framework change.

For release claims, rebuild both variants from a documented common feature
baseline, match the UI, viewport, data and engine revision, archive both
installers, and repeat on multiple representative machines. Measure first-run
and warmed launches separately. For voice performance, use the same input,
model, pitch extractor, precision, device and warmup; report realtime latency
and dropouts separately from offline throughput. A Rust coordinator alone does
not establish faster Python inference.
