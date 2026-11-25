"""Keep the pinned worker protocol while loading conversion only when needed."""

import ast
from pathlib import Path


class LazyVoiceConverter:
    def __init__(self):
        self._converter = None

    def cleanup_model(self):
        if self._converter is not None:
            self._converter.cleanup_model()

    def __getattr__(self, name):
        if self._converter is None:
            from backend.python.inference.optimized import install

            install()
            from rvc.infer.infer import VoiceConverter

            self._converter = VoiceConverter()
        return getattr(self._converter, name)


def run(backend):
    script = Path(backend) / "rvc/infer/worker.py"
    tree = ast.parse(script.read_text(encoding="utf-8"), filename=str(script))
    worker = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "run_worker"
    )
    imports = [
        node
        for node in worker.body
        if isinstance(node, ast.ImportFrom) and node.module == "rvc.infer.infer"
    ]
    if len(imports) != 1 or [
        (alias.name, alias.asname) for alias in imports[0].names
    ] != [("VoiceConverter", None)]:
        raise RuntimeError("Worker converter import changed; update adapter")
    worker.body.remove(imports[0])
    # Utility commands retain their own lazy imports. The serial worker keeps
    # the real converter and all model caches once a conversion needs them.
    namespace = {
        "__name__": __name__,
        "__file__": str(script),
        "VoiceConverter": LazyVoiceConverter,
    }
    exec(
        compile(tree, str(script), "exec"),
        namespace,
    )
    upstream_map_params = namespace["map_params"]

    def map_params(params, input_path, output_path):
        kwargs = upstream_map_params(params, input_path, output_path)
        if params.get("cleanupStage") == "output":
            kwargs["cleanup_stage"] = "output"
        return kwargs

    namespace["map_params"] = map_params
    namespace["run_worker"]()
