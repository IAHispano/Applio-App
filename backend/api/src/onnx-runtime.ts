/** ONNX Runtime's CPU and GPU wheels share files and must not coexist. */
export function onnxRuntimeDistribution(platform: string, amd: boolean): string {
  return platform === "win32" && !amd ? "onnxruntime-gpu" : "onnxruntime";
}

export function resolveOnnxRequirements(content: string, distribution: string): string {
  const lines = content.split(/\r?\n/);
  const runtime = lines.find(
    (line) => line.trim().match(/^onnxruntime(?:-gpu)?(?=[<>=;\s]|$)/)?.[0] === distribution,
  );
  if (!runtime) throw new Error(`Missing ${distribution} requirement`);
  // Platform/GPU choice has already been made, including Windows ROCm.
  const requirement = runtime.split(";")[0].trim();
  return [
    ...lines.filter((line) => !/^onnxruntime(?:-gpu)?(?=[<>=;\s]|$)/i.test(line.trim())),
    requirement,
  ].join("\n");
}

export function hasOnnxRuntimeConflict(installed: string[], distribution: string): boolean {
  return installed.some(
    (name) => (name === "onnxruntime" || name === "onnxruntime-gpu") && name !== distribution,
  );
}
