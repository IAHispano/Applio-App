"""Realtime regression checks. Optional: --model logs/voice/voice.pth --graphs."""
import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend' / 'applio'))
os.chdir(ROOT)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', type=Path)
parser.add_argument('--graphs', action='store_true')
args = parser.parse_args()
if args.graphs:
    os.environ['APPLIO_ENABLE_CUDA_GRAPHS'] = '1'

import numpy as np
import torch
from rvc.realtime.utils.vad import VADProcessor
from rvc.realtime.utils.chunks import automatic_block_frame
from rvc.realtime.pipeline import Realtime_Pipeline
from rvc.infer.pipeline import Autotune
from rvc.realtime.core import Realtime

assert automatic_block_frame(10) == 4800
assert automatic_block_frame(100) == 7200
assert automatic_block_frame(2000) == 48000
vad = VADProcessor()
assert not vad.is_speech(np.zeros(0, np.float32))

class LastFrameSpeech:
    def __init__(self):
        self.calls = 0

    def is_speech(self, frame, rate):
        self.calls += 1
        assert len(frame) == 960
        return self.calls == 2

vad.vad = LastFrameSpeech()
assert vad.is_speech(np.zeros(500, np.float32)), 'partial final frame omitted'
assert vad.is_speech(np.zeros(1600, np.float32)), 'first 100 ms of speech tail omitted'
assert vad.is_speech(np.zeros(1600, np.float32)), 'second 100 ms of speech tail omitted'
assert not vad.is_speech(np.zeros(1600, np.float32)), 'speech tail never expires'

class NoSpeech:
    def is_speech(self, *_):
        return False

for frequency in [100, 220, 440, 880]:
    sustained = VADProcessor()
    sustained.vad = NoSpeech()
    for n in range(100):
        time = np.arange(n * 1600, (n + 1) * 1600) / 16000
        vowel = (.08 * np.sin(2 * np.pi * frequency * time)
                 + .04 * np.sin(2 * np.pi * frequency * 2 * time)).astype(np.float32)
        assert sustained.is_speech(vowel), f'Sustained voice cut at {frequency} Hz, block {n}'
    sustained.is_speech(np.zeros(1600, np.float32))
    sustained.is_speech(np.zeros(1600, np.float32))
    assert not sustained.is_speech(np.zeros(1600, np.float32)), 'Sustained voice gate never closes'
for kind in ['noise', 'hum', 'silence']:
    detector = VADProcessor()
    detector.vad = NoSpeech()
    rng = np.random.default_rng(10)
    for n in range(50):
        audio = (rng.normal(0, .03, 1600) if kind == 'noise' else
                 .1 * np.sin(2 * np.pi * 50 * np.arange(n * 1600, (n + 1) * 1600) / 16000)
                 if kind == 'hum' else np.zeros(1600))
        assert not detector.is_speech(audio.astype(np.float32)), f'False positive: {kind}'
print('Sustained voice for 10 seconds, silence, random noise and 50 Hz hum passed.', flush=True)

for device in ['cpu'] + (['cuda'] if torch.cuda.is_available() else []):
    pipeline = Realtime_Pipeline.__new__(Realtime_Pipeline)
    pipeline.autotune_notes = torch.tensor(Autotune().note_dict, device=device)
    f0 = torch.tensor([0., 100., 220., 440.], device=device)
    result = pipeline.autotune_f0(f0, 1.)
    assert result[0].item() == 0
    assert abs(result[1].item() - 98.) < .1
    assert torch.equal(pipeline.autotune_f0(f0, 0.), f0)
    if device == 'cuda':
        stream = torch.cuda.Stream()
        stream.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(stream):
            for _ in range(3):
                pipeline.autotune_f0(f0, 1.)
        torch.cuda.current_stream().wait_stream(stream)
        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            captured = pipeline.autotune_f0(f0, 1.)
        graph.replay()
        assert torch.equal(captured, result)
print('VAD partial frames/tail and CPU/CUDA autotune capture passed.', flush=True)

class ConstantPipeline:
    calls = 0
    def voice_conversion(self, *args, **kwargs):
        self.calls += 1
        return torch.ones(160)

model = Realtime.__new__(Realtime)
model.pipeline = ConstantPipeline()
model.device, model.dtype = 'cpu', torch.float32
model.resample_in = model.resample_out = lambda audio: audio
model.audio_buffer = torch.zeros(160)
model.convert_buffer = torch.zeros(160)
model.pitch_buffer = model.pitchf_buffer = torch.zeros(1)
model.board = model.reduced_noise = model.vad = None
model.input_sensitivity = .001
model.convert_feature_size_16k = model.return_length = 1
model.silence_front = model.skip_head = model.block_frame_16k = 0
output, volume, silent = model.inference(np.full(160, .1, np.float32))
assert torch.equal(output, torch.ones(160)), 'Input RMS applied a second time'
assert abs(volume - .1) < .001 and not silent
output, volume, silent = model.inference(np.zeros(160, np.float32))
assert silent and not output.any() and not model.convert_buffer.any(), 'Stale context survived silence'
assert model.pipeline.calls == 1, 'Silent blocks still run model inference'
assert not model.pitch_buffer.any() and not model.pitchf_buffer.any(), 'Stale pitch survived silence'
print('RMS gain and silent-context regressions passed.', flush=True)

# Compare graph output with the existing eager SOLA/crossfade algorithm,
# including short decoder output, changing chunks and silence/onset history.
if torch.cuda.is_available():
    from types import SimpleNamespace
    from rvc.realtime.core import VoiceChanger
    class OutputModel:
        pipeline = SimpleNamespace(_graph_cache=None, _graph_failed=False)
        def inference(self, *args, **kwargs):
            return self.output.clone(), .1, False
    torch.manual_seed(101)
    for block, crossfade in [(4800, 2400), (9600, 2400), (4800, 4800)]:
        engine = VoiceChanger.__new__(VoiceChanger)
        engine.device = 'cuda'
        engine.block_frame, engine.crossfade_frame, engine.sola_search_frame = block, crossfade, 480
        engine.record_audio = False
        engine.vc_model = OutputModel()
        engine.generate_strength()
        history = torch.randn(crossfade, device='cuda') * .01
        graph_history = history.clone()
        for length in [block + crossfade + 480, block + crossfade - 100] * 3:
            engine.vc_model.output = torch.randn(length, device='cuda') * .02
            engine.sola_buffer.copy_(history)
            engine.vc_model.pipeline._graph_cache = None
            expected, _ = engine.process_audio(np.zeros(block, np.float32))
            history = engine.sola_buffer.clone()
            engine.sola_buffer.copy_(graph_history)
            engine.vc_model.pipeline._graph_cache = (True,)
            actual, _ = engine.process_audio(np.zeros(block, np.float32))
            graph_history = engine.sola_buffer.clone()
            assert np.allclose(actual, expected, rtol=1e-5, atol=1e-6), 'Graph alignment changed output'
            assert torch.allclose(history, graph_history, rtol=1e-5, atol=1e-6), 'Graph alignment changed history'
    print('CUDA output graph matches eager alignment/crossfade, short outputs and resized blocks.', flush=True)

if args.model:
    from rvc.realtime.core import VoiceChanger
    vc = VoiceChanger(block_frame=4800, cross_fade_overlap_size=.05, extra_convert_size=.5,
        model_path=str(args.model.resolve()), index_path='', f0_method='rmvpe',
        embedder_model='contentvec', silent_threshold=-90, vad_enabled=False)
    for fp16, autotune in [(False, False), (False, True), (True, True), (True, False), (False, True)]:
        vc.vc_model.pipeline.vc.decoder_fp16 = fp16
        timing = vc.warmup(f0_autotune=autotune)
        for _ in range(3):
            audio = (np.sin(np.arange(4800) * 2 * np.pi * 220 / 48000) * .05).astype(np.float32)
            output, volume, perf = vc.on_request(audio, f0_autotune=autotune)
            assert output.shape == (4800,) and np.isfinite(output).all()
        print(f'FP16={fp16}, autotune={autotune}: finite output, warmup {timing:.1f} ms', flush=True)
    from rvc.realtime.configuration import apply_config_update
    current = dict(model_path=str(args.model.resolve()), index_path='', f0_method='rmvpe',
        embedder_model='contentvec', embedder_model_custom=None, block_frame=4800,
        automatic_block_size=False, cross_fade_overlap_size=.05, extra_convert_size=.5,
        silent_threshold=-90, vad_enabled=False, sid=0, clean_audio=False,
        clean_strength=.5, post_process=False, decoder_fp16=False, f0_up_key=0,
        index_rate=0, protect=.5, volume_envelope=1, autotune=False, autotune_strength=1,
        input_audio_gain=100, kwargs={})
    for changes in [
        {'f0_up_key': 2, 'autotune': True},
        {'block_frame': 9600, 'vad_enabled': True, 'extra_convert_size': .2},
        {'block_frame': 4800, 'f0_method': 'fcpe', 'decoder_fp16': True},
        {'f0_method': 'rmvpe', 'decoder_fp16': False, 'f0_up_key': 0},
    ]:
        current = apply_config_update(vc, current, {'changes': changes})
        audio = (np.sin(np.arange(vc.block_frame) * 2 * np.pi * 220 / 48000) * .05).astype(np.float32)
        output, volume, perf = vc.on_request(audio, f0_up_key=current['f0_up_key'], f0_autotune=current['autotune'])
        assert output.shape == (vc.block_frame,) and np.isfinite(output).all()
    before = vc.vc_model.pipeline.vc
    for invalid in [{'model_path': 'missing.pth'}, {'index_path': 'missing.index'},
                    {'f0_method': 'invalid'}, {'block_frame': 100}, {'input_audio_gain': 201}]:
        try:
            apply_config_update(vc, current, {'changes': invalid})
            raise AssertionError(f'Accepted invalid update: {invalid}')
        except ValueError:
            assert vc.vc_model.pipeline.vc is before
    for _ in range(30):
        output, _, _ = vc.on_request((np.sin(np.arange(4800) * 2 * np.pi * 220 / 48000) * .05).astype(np.float32))
        assert np.isfinite(output).all() and np.abs(output).max() > 1e-6, 'VAD cut sustained converted audio'
    for _ in range(10):
        output, _, _ = vc.on_request(np.zeros(4800, np.float32))
        assert not output.any(), 'Gated silence contains stale audio'
    for _ in range(10):
        output, _, _ = vc.on_request((np.sin(np.arange(4800) * 2 * np.pi * 220 / 48000) * .05).astype(np.float32))
        assert np.isfinite(output).all() and np.abs(output).max() > 1e-6, 'Voice did not resume after silence'
    print('Live pitch/autotune, chunk resizing, VAD, predictor/FP16 switching, invalid updates and sustained converted voice passed.', flush=True)
