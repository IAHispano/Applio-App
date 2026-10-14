/** Shared explanations for settings; callers translate the English source text. */
export const SETTING_HELP = {
  inferenceEngine:
    "ONNX converts the HiFi-GAN NSF decoder and reuses it for single or batch files. First use exports the model; other stages stay in PyTorch.",
  onnxPrecision:
    "Auto uses FP16 on NVIDIA CUDA and FP32 elsewhere. FP16 uses less memory but can slightly change audio. Export requires the ONNX package.",
  voiceModel: "Choose the trained voice that will replace the original voice.",
  index: "Use the index paired with this voice model to refine its timbre. None uses only the model.",
  pitch: "Shift the voice in semitones: negative lowers it, positive raises it.",
  indexRate:
    "Blend in the model's index features. Higher values strengthen the timbre match but may add artifacts.",
  protect: "Protect breaths and unvoiced consonants. Lower values add more protection; 0.5 disables it.",
  envelope: "Blend loudness envelopes: 0 follows the source, 1 keeps the converted voice's dynamics.",
  pitchMethod:
    "Choose how pitch is detected. Compare methods if notes are unstable or processing is too slow.",
  embedder:
    "Extract speech features for conversion. Use the same embedder that was used to train the voice model.",
  customEmbedder: "Enter the folder containing your custom speech embedder's model and configuration files.",
  export: "Choose the saved audio format. WAV and FLAC are lossless; MP3, OGG and M4A use compression.",
  speaker: "Choose a voice within a multi-speaker checkpoint. This does not select a different model file.",
  split: "Split long recordings into smaller sections before conversion to reduce memory use.",
  autotune: "Move detected pitches toward musical notes. Disable it to keep natural pitch variation.",
  autotuneStrength:
    "Control how strongly pitches move toward musical notes: 0 keeps them unchanged, 1 fully snaps them.",
  proposed: "Automatically shift pitch using the detected voice pitch and your target threshold.",
  proposedThreshold: "Set the target pitch in Hz for automatic pitch adjustment.",
  formant: "Change vocal resonance to adjust voice character separately from musical pitch.",
  fp16: "Use half precision for the CUDA decoder. Speed depends on your GPU; disable it if output is unstable.",
  voiceFocus:
    "Clean microphone noise locally with Voice Focus. c20 uses less processing; c50 and c100 use more.",
  chunk:
    "Set how much audio is converted per block. Shorter blocks can reduce delay but give less processing headroom.",
  autoChunk: "Choose block size from measured processing time, with headroom to keep streaming stable.",
  crossfade: "Blend neighboring converted blocks over this many seconds to smooth their boundaries.",
  context: "Keep this much past audio as conversion context. More context uses more memory and processing.",
  silence: "Mute input below this level in dB. A more negative threshold lets quieter sounds through.",
  inputGain: "Adjust microphone level before conversion. Too much gain can overload the input.",
  outputGain: "Adjust local playback level after conversion. This does not change model inference.",
  vad: "Detect speech and mute non-speech input. Disable it if quiet speech is being cut off.",
  inputDevice: "Choose the microphone or audio source to convert.",
  outputDevice: "Choose where converted audio plays. Use a virtual cable to send it to another app.",
  recordPath: "Choose where the engine saves the converted recording on this computer.",
  epochs:
    "Set the number of complete passes through the training dataset. More passes take longer and can overfit.",
  batchSize: "Process this many training examples together. Larger batches need more GPU memory.",
  saveEvery: "Save a training checkpoint after this many epochs.",
  saveLatest: "Keep only the latest periodic training checkpoint to reduce disk use.",
  saveWeights: "Export a usable voice model at each checkpoint interval, not only training state.",
  fresh: "Remove previous training outputs before starting. Use this only when you want a fresh run.",
  cacheGPU:
    "Keep training data in CUDA or ROCm GPU memory to reduce loading time. Requires additional VRAM; ignored on MPS and CPU.",
  checkpointing: "Reduce GPU memory use by recomputing intermediate activations. Training may be slower.",
  customPretrained:
    "Choose your own generator and discriminator starting weights. Match the vocoder and sample rate.",
  pretrainedG: "Select the generator starting weights that match this model's vocoder and sample rate.",
  pretrainedD: "Select the discriminator starting weights that match this model's vocoder and sample rate.",
  pretrainedURL: "Enter a direct download URL for pretrained weights matching the vocoder and sample rate.",
  sampleRate:
    "Set the audio sampling rate in Hz. Use matching rates for preprocessing, training and pretrained weights.",
  vocoder: "Choose the network that synthesizes audio. Changing it requires compatible pretrained weights.",
  indexAlgorithm:
    "Choose how extracted features are organized into an index. Auto selects the method for you.",
  normalize: "Normalize before preprocessing, after preprocessing, or not at all.",
  cutting:
    "Choose how recordings are split into training clips: Skip keeps them intact, Simple uses fixed clips, Automatic uses silence.",
  trainChunk: "Set training clip length in seconds when using simple audio cutting.",
  trainOverlap: "Set how much neighboring training clips overlap, in seconds.",
  noiseFilter: "Apply a high-pass filter to reduce low-frequency noise in training audio.",
  mutes: "Add silent examples during feature extraction to help the model handle silence.",
  dataset: "Choose the folder of clean recordings used to train this voice.",
  modelName: "Name the model and its output folder. Use a distinct name for each training project.",
  cpu: "Choose how many CPU workers prepare the dataset. Leave capacity for other apps if needed.",
  gpu: "Choose the GPU used for processing. CPU mode avoids GPU memory use but is usually slower.",
  batchMode:
    "Choose one model for many files, many models for one file, or every selected model for every file.",
  batchInput: "Choose the source audio file or folder on the computer running the engine.",
  batchOutput: "Choose where converted files are saved. Multi-model batches create a folder for each model.",
  ttsText: "Enter the words to speak before optional voice conversion.",
  textFile: "Load spoken text from a UTF-8 text file instead of typing it.",
  ttsVoice: "Choose the speech voice and language used to read your text.",
  ttsSpeed: "Change speech speed. Positive values speak faster; negative values speak slower.",
  blend:
    "Mix model weights: 0 uses only the second model, 1 uses only the first model. Both models must be compatible.",
  blendModel: "Select a checkpoint to blend. Both checkpoints must share a compatible architecture.",
  pretrainedDownload: "Choose the pretrained weight family to download for training.",
  customURLs: "Provide your own download links for the generator and discriminator weights.",
  author: "Set the author name stored in models you train or export.",
  precision:
    "Choose numeric precision for supported engine operations. Full precision uses more memory; half precision may be faster.",
  highRegister:
    "Extend RMVPE pitch detection for high notes. Enable this when high singing notes are missed.",
  highMode: "Choose how extended RMVPE pitch detection handles high-register audio.",
  ceiling: "Set the highest pitch RMVPE should detect, in Hz.",
  storage:
    "Choose the folder for models and training files. Moving an existing folder takes effect after restart.",
  filterBox: "Show search boxes for finding models and index files more quickly.",
  discord: "Show your Applio activity in Discord Rich Presence.",
  language: "Choose the interface language. Auto follows your operating system language.",
  font: "Choose the interface font. This changes appearance, not audio processing.",
  separation: "Choose the separation model that splits a recording into vocals or other stems.",
  stems: "Choose which separated audio tracks to save.",
  demucsSegment:
    "Set the length of each Demucs processing segment in seconds. Longer segments use more memory.",
  roformerChunk:
    "Set the length of each Roformer processing chunk in seconds. Longer chunks use more memory.",
  audioSource: "Choose an existing audio file as the source for this operation.",
  modelExport: "Choose the voice checkpoint to include in the exported model package.",
  indexExport: "Choose the matching index to include with the exported voice checkpoint.",
  modelInspect: "Choose a voice checkpoint to inspect its architecture and training information.",
  pretrained:
    "Start training from existing weights instead of random weights. Missing default weights download automatically.",
  uploadName:
    "Name the destination folder for these uploaded files so you can find them in training settings.",
  rmvpe: "Neural pitch detection for speech and singing; suitable as a starting point for voice conversion.",
  fcpe: "A lightweight neural pitch detector; compare its pitch stability and processing time with RMVPE.",
  swift: "An alternative pitch detector. Compare its results when another method misses notes.",
} as const;

export const PITCH_METHOD_HELP: Record<string, string> = {
  rmvpe: SETTING_HELP.rmvpe,
  fcpe: SETTING_HELP.fcpe,
  swift: SETTING_HELP.swift,
};
