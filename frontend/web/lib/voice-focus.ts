export type VoiceFocusVariant = "off" | "c20" | "c50" | "c100";

let supportProbe: Promise<boolean> | null = null;

/**
 * Voice Focus fetches its processors, workers and WASM models from the Amazon
 * CDN by default, which relies on cross-origin loading that not every engine
 * accepts (a cross-origin worker can only come from a blob URL, and worklet
 * modules are engine-dependent). The native API proxies the same assets on
 * `/voicefocus/*`, so every request the SDK makes is same-origin instead.
 *
 * The URLs must be absolute: the SDK hands them to a worker, which for a
 * cross-origin script is created from a blob URL and cannot resolve relative
 * paths.
 */
const ASSET_PATHS =
  typeof window === "undefined"
    ? { processors: "", workers: "", wasm: "", models: "" }
    : {
        processors: `${window.location.origin}/voicefocus/processors/`,
        workers: `${window.location.origin}/voicefocus/workers/`,
        wasm: `${window.location.origin}/voicefocus/wasm/`,
        models: `${window.location.origin}/voicefocus/wasm/`,
      };

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
      return await Transformer.isSupported({ paths: ASSET_PATHS });
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
  // Load the SDK and AWS model assets only when explicitly enabled.
  const { default: Transformer } = await import(
    "amazon-chime-sdk-js/build/voicefocus/VoiceFocusDeviceTransformer"
  );
  const transformer = await Transformer.create({ variant, name: "default", paths: ASSET_PATHS });
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
