import fs from "node:fs";
import path from "node:path";
import { getRepoRoot, resolveUserPath } from "@/python";

const SAMPLE_RATES: Record<string, string[]> = {
  "HiFi-GAN": ["32000", "40000", "48000"],
  RefineGAN: ["24000", "32000"],
};

export function pretrainedFileReady(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function defaultPretrainedPaths(vocoder: string, sampleRate: string): [string, string] {
  if (!SAMPLE_RATES[vocoder]?.includes(sampleRate)) {
    throw new Error(`Unsupported pretrained: ${vocoder} at ${sampleRate} Hz`);
  }
  const base = path.join(getRepoRoot(), "rvc", "models", "pretraineds", vocoder.toLowerCase());
  const tag = Number(sampleRate) / 1000;
  return [path.join(base, `f0G${tag}k.pth`), path.join(base, `f0D${tag}k.pth`)];
}

export function missingDefaultPretraineds(): string[] {
  return Object.entries(SAMPLE_RATES)
    .flatMap(([vocoder, rates]) => rates.flatMap((rate) => defaultPretrainedPaths(vocoder, rate)))
    .filter((file) => !pretrainedFileReady(file));
}

export function resolvePretrained(
  vocoder: string,
  sampleRate: string,
  customPretrained: boolean,
  gPath?: string,
  dPath?: string,
): [string, string] {
  const paths: [string, string] = customPretrained
    ? [gPath ? resolveUserPath(gPath) : "", dPath ? resolveUserPath(dPath) : ""]
    : defaultPretrainedPaths(vocoder, sampleRate);
  if (!paths.every(pretrainedFileReady)) {
    throw new Error(
      customPretrained
        ? "Custom pretrained G and D files must exist and be non-empty."
        : `Default ${vocoder} pretrains (${sampleRate} Hz) are missing. Training cannot start without them.`,
    );
  }
  return paths;
}
