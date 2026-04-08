"""Resolve ONNX Runtime execution providers without requesting missing CUDA."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import onnxruntime as ort


def resolve_onnx_providers(want_cuda: bool) -> list[str]:
    try:
        import onnxruntime as ort

        available = set(ort.get_available_providers())
    except Exception:
        available = set()
    if want_cuda and "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def create_onnx_session_low_memory(
    model_path: str,
    providers: list[str] | None = None,
) -> "ort.InferenceSession":
    """Create an ONNX session tuned for lower peak RAM on CPU (e.g. Windows).

    Used when loading head pose after other models: avoids ``bad allocation`` from
    the default arena + multi-threaded allocators stacking with RetinaFace/ArcFace.

    Must match the signature of ``uniface.onnx_utils.create_onnx_session`` so it
    can replace ``uniface.headpose.models.create_onnx_session`` for that import only.
    """
    import onnxruntime as ort
    from uniface.onnx_utils import get_available_providers

    if providers is None:
        providers = get_available_providers()

    sess_options = ort.SessionOptions()
    sess_options.log_severity_level = 3
    sess_options.enable_cpu_mem_arena = False
    sess_options.intra_op_num_threads = 1
    sess_options.inter_op_num_threads = 1

    return ort.InferenceSession(
        model_path, sess_options=sess_options, providers=providers
    )
