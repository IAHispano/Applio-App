// Route Web Audio directly to the device when possible, avoiding the
// MediaStream -> HTMLAudioElement playback queue in modern Chromium.
export async function connectRealtimeOutput(
  ctx: AudioContext,
  source: AudioNode,
  deviceId: string,
): Promise<HTMLAudioElement[]> {
  const routable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!deviceId || routable.setSinkId) {
    if (deviceId) await routable.setSinkId?.(deviceId);
    source.connect(ctx.destination);
    await ctx.resume();
    return [];
  }
  const destination = ctx.createMediaStreamDestination();
  source.connect(destination);
  const element = new Audio();
  element.srcObject = destination.stream;
  const selectable = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (!selectable.setSinkId) throw new Error("Audio output device selection is unavailable in this browser.");
  await selectable.setSinkId(deviceId);
  await element.play();
  await ctx.resume();
  return [element];
}
