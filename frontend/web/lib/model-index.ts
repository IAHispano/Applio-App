// Shared voice/index pairing: prefer a same-folder match on the model stem,
// mirroring Gradio's match_index. Used by inference, realtime and TTS so the
// three pickers pair indexes identically.
export function matchIndex(model: string, indexes: string[]): string {
  if (!model || indexes.length === 0) return "";
  const normModel = model.replace(/\\/g, "/");
  const dir = normModel.includes("/") ? normModel.slice(0, normModel.lastIndexOf("/")) : "";
  const filename = normModel.split("/").pop() ?? "";
  const stem = filename.replace(/\.(pth|onnx)$/i, "").toLowerCase();
  const normIndexes = indexes.map((i) => i.replace(/\\/g, "/"));
  const sameDir = normIndexes.filter((i) => (i.includes("/") ? i.slice(0, i.lastIndexOf("/")) : "") === dir);
  const byStem = (list: string[]) =>
    list.find((i) => (i.split("/").pop() ?? "").toLowerCase().startsWith(stem.slice(0, 8)));
  const matchedNorm =
    byStem(sameDir.length > 0 ? sameDir : normIndexes) || (sameDir.length === 1 ? sameDir[0] : "") || "";
  if (!matchedNorm) return "";
  const matchedIdx = normIndexes.indexOf(matchedNorm);
  return matchedIdx >= 0 ? indexes[matchedIdx] : matchedNorm;
}
