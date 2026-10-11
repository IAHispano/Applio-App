export type VoiceFocusVariant = "off" | "c20" | "c50" | "c100";

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
