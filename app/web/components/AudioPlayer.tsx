"use client";

import AudioWavePlayer, { type AudioWavePlayerProps } from "./AudioWavePlayer";

export type AudioPlayerProps = AudioWavePlayerProps;

/**
 * Unified AudioPlayer component that delegates to the modern, accessible
 * AudioWavePlayer with consistent button styling, A/B toggle, and volume controls.
 */
export default function AudioPlayer(props: AudioWavePlayerProps) {
  return <AudioWavePlayer {...props} />;
}
