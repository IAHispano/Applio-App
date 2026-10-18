import {
  Activity,
  AudioWaveform,
  Bug,
  Code2,
  Cpu,
  Database,
  House,
  Layers,
  type LucideIcon,
  Mic,
  Radio,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

export interface NavEntry {
  icon: LucideIcon;
  label: string;
  to: string;
  blurb: string;
  badge?: string;
}

export interface NavSection {
  title?: string;
  items: NavEntry[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ icon: House, label: "Home", to: "/", blurb: "Overview, quick actions and system status" }],
  },
  {
    title: "Voice",
    items: [
      {
        icon: Sparkles,
        label: "Convert Audio",
        to: "/inference",
        blurb: "Convert audio files single or batch",
      },
      { icon: Radio, label: "Realtime", to: "/realtime", blurb: "Live microphone voice conversion" },
      { icon: Mic, label: "Text to Speech", to: "/tts", blurb: "Synthesize speech and convert voice" },
    ],
  },
  {
    title: "Models & Training",
    items: [
      { icon: Database, label: "Models", to: "/models", blurb: "Manage installed voice models and weights" },
      { icon: Cpu, label: "Training", to: "/train", blurb: "Preprocess, extract, train, and index" },
      {
        icon: Layers,
        label: "Voice Blender",
        to: "/voice-blender",
        blurb: "Fuse two models into a single checkpoint",
      },
      { icon: Activity, label: "TensorBoard", to: "/tensorboard", blurb: "Track training loss and metrics" },
    ],
  },
  {
    title: "Tools & Extras",
    items: [
      {
        icon: SlidersHorizontal,
        label: "Audio Tools",
        to: "/extra",
        blurb: "Audio analyzer and pitch extractor",
      },
      {
        icon: AudioWaveform,
        label: "Audio Separator",
        to: "/audio-separator",
        blurb: "Split vocals, instrumental and stems",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        icon: Code2,
        label: "API & Workflows",
        to: "/api-access",
        blurb: "Connect apps and automate audio workflows",
      },
      {
        icon: Activity,
        label: "Job history",
        to: "/jobs",
        blurb: "Recent jobs, outputs and interrupted work",
      },
      { icon: Settings, label: "Settings", to: "/settings", blurb: "Engine configuration and preferences" },
      { icon: Bug, label: "Report a Bug", to: "/report", blurb: "System diagnostics and issue reporting" },
      {
        icon: ShieldCheck,
        label: "Your data & privacy",
        to: "/your-data",
        blurb: "Understand your rights, local processing, and optional online features.",
      },
    ],
  },
];

export const MENU: NavEntry[] = NAV_SECTIONS.flatMap((s) => s.items);
