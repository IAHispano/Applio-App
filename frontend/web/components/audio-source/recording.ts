export async function blobToWavFile(blob: Blob, baseName: string): Promise<File> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const nCh = Math.min(audio.numberOfChannels, 2);
    const len = audio.length;
    const buf = new ArrayBuffer(44 + len * nCh * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + len * nCh * 2, true);
    str(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, nCh, true);
    v.setUint32(24, audio.sampleRate, true);
    v.setUint32(28, audio.sampleRate * nCh * 2, true);
    v.setUint16(32, nCh * 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, len * nCh * 2, true);
    const ch: Float32Array[] = [];
    for (let c = 0; c < nCh; c++) ch.push(audio.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++)
      for (let c = 0; c < nCh; c++) {
        const s = Math.max(-1, Math.min(1, ch[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    return new File([buf], `${baseName}.wav`, { type: "audio/wav" });
  } finally {
    void ctx.close().catch(() => {});
  }
}

export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "";
}
