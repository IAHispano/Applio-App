// Route Web Audio directly to the device when possible, avoiding the
// MediaStream -> HTMLAudioElement playback queue in modern Chromium.
export const DEFAULT_REALTIME_OUTPUT = "default";

export async function connectRealtimeOutput(
  ctx: AudioContext,
  source: AudioNode,
  deviceId: string,
): Promise<HTMLAudioElement[]> {
  // An empty sink ID selects the system default without requiring output
  // enumeration or HTMLAudioElement.setSinkId support (including WebKit).
  const sinkId = deviceId === DEFAULT_REALTIME_OUTPUT ? "" : deviceId;
  const routable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!sinkId || routable.setSinkId) {
    await routable.setSinkId?.(sinkId);
    source.connect(ctx.destination);
    await ctx.resume();
    return [];
  }
  const destination = ctx.createMediaStreamDestination();
  source.connect(destination);
  const element = new Audio();
  element.srcObject = destination.stream;
  const selectable = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  try {
    if (!selectable.setSinkId)
      throw new Error("Audio output device selection is unavailable in this browser.");
    await selectable.setSinkId(sinkId);
    await element.play();
    await ctx.resume();
    return [element];
  } catch (error) {
    source.disconnect(destination);
    element.pause();
    element.srcObject = null;
    destination.stream.getTracks().forEach((track) => {
      track.stop();
    });
    throw error;
  }
}
