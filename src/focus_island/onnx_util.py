"""Resolve ONNX Runtime execution providers without requesting missing CUDA."""

from __future__ import annotations


def resolve_onnx_providers(want_cuda: bool) -> list[str]:
    try:
        import onnxruntime as ort

        available = set(ort.get_available_providers())
    except Exception:
        available = set()
    if want_cuda and "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]
