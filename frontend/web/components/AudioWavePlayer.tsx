"use client";

import dynamic from "next/dynamic";

export type { AudioWavePlayerProps } from "./AudioWavePlayerImpl";

// WaveSurfer and its controls are only needed once there is audio to display.
export default dynamic(() => import("./AudioWavePlayerImpl"), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded-xl bg-white/5" aria-busy="true" />,
});
