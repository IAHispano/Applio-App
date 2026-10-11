# MPS workflows and optional ONNX decoder

No Apple hardware was available for this implementation. Passing CPU/CUDA regression checks and simulated routing is not evidence of successful execution or improved speed on Metal.

## macOS

The shared backend configuration selects CUDA first, then MPS when available, then CPU. File inference uses a copy of the configuration so its existing bounded CPU retry does not change another session's device. Realtime uses the same selection and an isolated session configuration; a recognized MPS error during startup/warmup triggers one CPU startup retry. Unrelated errors remain visible.

- HuBERT and voice synthesis run on MPS in FP32; CUDA graphs and experimental CUDA precision are excluded.
- FCPE and RMVPE keep their neural networks on MPS and compute their complex spectral frontend on CPU. CREPE retains a CPU compatibility path on Metal. Audio preprocessing remains on CPU.
- Phase-vocoder crossfades and optional noise-reduction FFT processing run on CPU and return floating audio to Metal. Live noise-reduction changes follow the same policy.
- Feature extraction submits one embedding task at a time per MPS worker, reducing model concurrency on shared memory. Recognized MPS failures can switch pitch/embedding extraction to CPU; embedding task exceptions now propagate rather than being lost.
- Training runs a single MPS process in FP32. Spectral losses use differentiable device copies around CPU FFT; the neural network and optimizers stay on Metal. Two loader workers and a prefetch factor of two limit queue memory, with CUDA-only pinned memory. File conversion bounds long-file chunk size more conservatively on MPS.
- Standalone training, extraction, config, inference and realtime entry points set `PYTORCH_ENABLE_MPS_FALLBACK=1` before loading Torch on macOS, preserving an explicit user setting.

Validation available on a Mac:

```powershell
.venv/bin/python scripts/check-mps-workflows.py --hardware --model /absolute/path/model.pth
.venv/bin/python scripts/check-mps-inference.py --model /absolute/path/model.pth --audio /absolute/path/speech.wav
```

The workflow hardware check covers real pitch networks, a differentiable spectral loss, warmup, and a complete realtime block. It does not run a complete training epoch or a large dataset extraction. Those remain required Mac validation, including RefineGAN/HiFi-GAN MRF, low-memory devices and long sessions. Compatibility CPU spectral work may limit performance; no fast-math or mixed precision is forced on Metal.

## ONNX

ONNX export currently covers the **f0 HiFi-GAN NSF decoder**, not the entire RVC pipeline. PyTorch retains HuBERT, retrieval, pitch, encoder, flow and stochastic excitation. Supplying the same latent features, source waveform and speaker embedding makes numerical parity measurable without disabling source noise or changing the voice model.

Export and benchmark:

```powershell
.venv/Scripts/python.exe -m pip install onnx
.venv/Scripts/python.exe scripts/benchmark-onnx-decoder.py --model C:/absolute/model.pth --output C:/absolute/model.decoder.onnx
```

The engine runtime already requires ONNX Runtime. The `onnx` package is an optional export dependency. The export produces a graph plus a manifest binding the graph to the checkpoint with SHA-256 hashes. Dynamic frame lengths are supported; mismatching/corrupted caches are rejected. RefineGAN, HiFi-GAN MRF and non-f0 models are not supported by this export.

Opt in for a realtime service launched from the same shell:

```powershell
$env:APPLIO_EXPERIMENTAL_ONNX_DECODER = 'C:/absolute/model.decoder.onnx'
pnpm run desktop:dev
```

Remove the environment variable to return to the regular decoder. This does not change saved settings. Model swaps require a cache for the new model; otherwise the manifest rejects the mismatch. The CUDA adapter binds GPU tensors directly and captures the Torch encoder/flow/source prefix separately from the ONNX decoder. At most four decoder shapes are retained for graph replay; further shapes use eager execution. CPU/CoreML adapters use host transfers and exclude Torch CUDA capture. ONNX sessions use CPU, available NVIDIA CUDA, or available CoreML providers according to the selected device. **CoreML is a separate ONNX Runtime backend, not PyTorch MPS.** Provider availability and graph partitioning determine how much runs on the accelerator. CPU/CoreML input/output host transfers are included in the adapter. CUDA runtime uses GPU I/O binding; the standalone kernel benchmark also measures a host-fed ONNX session, so its timings do not represent the captured realtime runtime. ROCm does not use this CUDA path.

### Measured here

Initial test: RTX 3060 Ti host, Messi RVC v2 40 kHz HiFi-GAN NSF, Torch 2.11.0+cu128, ONNX Runtime 1.30.0 CPU provider, two CPU threads, five warmups and 40 timed iterations per frame size. No ONNX CUDA or CoreML provider was installed for this CPU comparison. An isolated CUDA provider comparison showed that the initial host-transfer CUDA adapter was slower; the optimized path below preserves GPU tensors and graph capture. CoreML remains untested.

| Decoder frames | PyTorch CPU median | ONNX CPU median | PyTorch CUDA FP32 median |
| --- | ---: | ---: | ---: |
| 6 | 78.59 ms | 47.85 ms | 10.33 ms |
| 10 | 115.97 ms | 77.82 ms | 11.34 ms |
| 20 | 208.98 ms | 150.85 ms | 10.33 ms |

These are decoder kernel measurements, not input-to-output latency or full-block timing. ONNX CPU was about 28–39% faster than PyTorch CPU in this run. Different input lengths can choose different convolution kernels; CUDA timings are not guaranteed to increase with frame count. Export/runtime output differences were at most 1.64e-6 absolute, with identical shapes at all three lengths. The actual adapter, including the unchanged stochastic source with matched Torch seeds, also passed parity.

The complete CPU realtime pipeline also passed warmup and three converted audio blocks with the ONNX adapter enabled; stale checkpoint manifests were rejected. This verifies integration, not audio-device latency or listening quality.

The earlier standalone CUDA FP16 decoder measurements were 13.12–14.21 ms in this experiment, slower than FP32. This is a different decoder-only eager benchmark from the earlier full realtime test. Precision/ONNX should remain optional and be judged using full-block and audio-device measurements for the target hardware.

Results: `.cache/onnx-decoder/Messi.decoder.benchmark.json`. The exported files remain ignored/local. Benchmark ordering was a single pass; before promoting a default, repeat with reversed ordering, real speech/model diversity, full realtime adapter timing and actual Mac/ONNX GPU hardware.

References: [PyTorch MPS](https://docs.pytorch.org/docs/stable/notes/mps.html), [ONNX Runtime CoreML](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html), [ONNX Runtime CUDA](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html).

### Experimental NVIDIA GPU path

Export an FP16 graph using an environment with compatible PyTorch CUDA, `onnx`, and `onnxruntime-gpu` (tested with ORT 1.22.0 / CUDA 12 / cuDNN 9):

```powershell
.venv/Scripts/python.exe scripts/benchmark-onnx-decoder.py --provider cuda --precision float16 --model C:/absolute/model.pth --output C:/absolute/model.decoder.fp16.onnx
$env:APPLIO_EXPERIMENTAL_ONNX_DECODER = 'C:/absolute/model.decoder.fp16.onnx'
pnpm desktop:dev
```

Use one ONNX Runtime distribution in that environment; the CPU package does not provide CUDA. Confirm the startup log says `CUDA I/O binding`. FP16 graphs require the CUDA provider. A requested CUDA provider that fails to initialize reports an error. If the CUDA provider is absent, an FP32 graph can use the host adapter; its startup log identifies that path.

The graph manifest records FP32/FP16 precision as well as model hashes and dimensions. The regular decoder FP16 toggle still controls Torch excitation autocast; ONNX convolution precision comes from the exported graph. Unsupported architectures and mismatched checkpoints fail explicitly rather than using another voice. Model swaps require a matching export and restarting with its path.

The final paired full-pipeline comparison on the RTX 3060 Ti measured about **15.97 ms for FP16 ONNX versus 17.35 ms for PyTorch**, roughly 8% less processing time. This includes Torch pitch/HuBERT/retrieval/synthesis prefix, GPU decoder binding, resampling and crossfade, but excludes microphone, network and playback latency. All measured blocks were finite and met the 100ms compute deadline. FP32 ONNX remained slower (about 22.4 vs 17.2 ms). These are one-model measurements, not a general speed guarantee.

CUDA validation covers dynamic lengths, four-shape cache bounds, repeated replay, independently owned output buffers, another caller stream, and FP32/FP16 numerical parity with matching input precision. Ordinary PyTorch synthesis remained bit-identical to the previous implementation with matched seeds across full/trimmed inference and both decoder precision modes.

FP16 numerical parity is approximate. A short ASR diagnostic regressed from 33.3% disagreement to 50% in both GPU FP16 comparisons; equal-shaped finite output and kernel parity do not establish perceptual quality. Keep this path experimental, compare actual recordings, and listen before using it for critical output. CoreML and actual MPS hardware remain untested here.

### Swift pitch and speech gating

Swift is already available in realtime. With one second of history on this machine, the full block medians were approximately 12.46ms for FCPE, 17.84ms for RMVPE, and 49.98ms for Swift. Its current host ONNX pitch path does not participate in the Torch CUDA graph. Swift improved the short ASR agreement diagnostic (11.1% disagreement vs 22.2% for FCPE/RMVPE), which supports keeping it as an option; it is insufficient evidence to replace FCPE as the low-latency default.

Realtime microphone capture explicitly disables browser automatic gain, noise suppression and echo cancellation to avoid preprocessing quiet or held speech before backend detection. The backend gate drains already generated crossfade audio once instead of immediately zeroing it. The meter labels input level explicitly; output monitoring measures output separately. This preserves bounded silence handling without retaining old utterances.

Desktop passthrough sends the raw microphone to the selected output, applies input/output gains and uses a 10ms transition. Conversion continues while bypassed so switching back remains warm. The configurable global shortcut defaults to `CommandOrControl+Alt+V`, registers only during streaming and reports conflicts. Recordings remain the converted server output.
