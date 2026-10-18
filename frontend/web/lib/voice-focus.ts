export type VoiceFocusVariant = "off" | "c20" | "c50" | "c100";

export function realtimeMicrophoneConstraints(
  deviceId: string,
  variant: VoiceFocusVariant,
): MediaTrackConstraints {
  return {
    deviceId: { exact: deviceId },
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    noiseSuppression: variant === "off",
    echoCancellation: variant === "off",
    // Automatic gain boosts quiet rooms and mouse clicks between phrases.
    // Input gain is controlled explicitly by the realtime gain slider.
    autoGainControl: false,
  };
}

let supportProbe: Promise<boolean> | null = null;

/**
 * Cheap capability check for the Voice Focus variants, run before offering
 * them. Voice Focus needs WASM audio worklets plus worker and asset loading
 * that stripped-down system WebViews can reject; failing early keeps the raw
 * microphone live instead of silencing input.
 */
export function voiceFocusSupported(): Promise<boolean> {
  supportProbe ??= (async () => {
    try {
      const { default: Transformer } = await import(
        "amazon-chime-sdk-js/build/voicefocus/VoiceFocusDeviceTransformer"
      );
      return await Transformer.isSupported();
    } catch {
      return false;
    }
  })();
  return supportProbe;
}

export async function connectVoiceFocus(
  context: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  stream: MediaStream,
  variant: Exclude<VoiceFocusVariant, "off">,
): Promise<() => Promise<void>> {
  // WebKit may suspend capture until the graph is running. Initialize the
  // Voice Focus worklet only after the context has started rendering.
  await context.resume();
  // Load the SDK and AWS model assets only when explicitly enabled.
  const { default: Transformer } = await import(
    "amazon-chime-sdk-js/build/voicefocus/VoiceFocusDeviceTransformer"
  );
  const transformer = await Transformer.create({ variant, name: "default" });
  try {
    if (!transformer.isSupported()) throw new Error("Voice Focus is unavailable in this browser.");
    const device = await transformer.createTransformDevice(stream);
    if (!device) throw new Error("Voice Focus could not initialize.");
    try {
      const nodes = await device.createAudioNode(context);
      source.connect(nodes.start);
      nodes.end.connect(destination);
      let stopped = false;
      return async () => {
        if (stopped) return;
        stopped = true;
        try {
          try {
            nodes.end.disconnect();
          } finally {
            await device.stop();
          }
        } finally {
          await Transformer.destroyVoiceFocus(transformer);
        }
      };
    } catch (error) {
      await device.stop();
      throw error;
    }
  } catch (error) {
    await Transformer.destroyVoiceFocus(transformer);
    throw error;
  }
}
