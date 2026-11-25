"""Offline utility to export MiniFASNet V2 / V1SE PyTorch state_dict checkpoints to ONNX.

Usage (local developer machine only; never downloads weights):
    python scripts/export_minifasnet_onnx.py \\
        --arch v2 \\
        --checkpoint weights/2.7_80x80_MiniFASNetV2.pth \\
        --output weights/minifasnet_v2.onnx

Note: This script expects the upstream `MiniFASNet.py` module definitions from
`minivision-ai/Silent-Face-Anti-Spoofing` (Apache-2.0) to be available on PYTHONPATH
or passed via `--model-def-dir`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch


def export_minifasnet_to_onnx(
    *,
    arch: str,
    checkpoint_path: Path,
    output_path: Path,
    model_def_dir: Path | None = None,
    input_size: int = 80,
    opset: int = 17,
) -> None:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    if model_def_dir is not None:
        sys.path.insert(0, str(model_def_dir.resolve()))

    try:
        from src.model_lib.MiniFASNet import MiniFASNetV1SE, MiniFASNetV2  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ImportError(
            "Could not import MiniFASNetV2 / MiniFASNetV1SE from src.model_lib.MiniFASNet. "
            "Pass --model-def-dir pointing to a local checkout of Silent-Face-Anti-Spoofing."
        ) from exc

    arch_norm = arch.strip().lower()
    if arch_norm == "v2":
        model = MiniFASNetV2(conv6_kernel=(5, 5))
    elif arch_norm == "v1se":
        model = MiniFASNetV1SE(conv6_kernel=(5, 5))
    else:
        raise ValueError(f"Unsupported arch '{arch}'. Expected 'v2' or 'v1se'.")

    state = torch.load(str(checkpoint_path), map_location="cpu", weights_only=True)
    # Upstream Silent-Face-Anti-Spoofing checkpoints prefix keys with 'module.' from DataParallel.
    cleaned_state = {
        (k[7:] if k.startswith("module.") else k): v
        for k, v in state.items()
    }
    model.load_state_dict(cleaned_state)
    model.eval()

    dummy_input = torch.randn(1, 3, input_size, input_size, dtype=torch.float32)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),
        input_names=["input"],
        output_names=["logits"],
        opset_version=opset,
        do_constant_folding=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Export MiniFASNet .pth state_dict to ONNX.")
    parser.add_argument("--arch", required=True, choices=["v2", "v1se"])
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-def-dir", type=Path, default=None)
    parser.add_argument("--input-size", type=int, default=80)
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    export_minifasnet_to_onnx(
        arch=args.arch,
        checkpoint_path=args.checkpoint,
        output_path=args.output,
        model_def_dir=args.model_def_dir,
        input_size=args.input_size,
        opset=args.opset,
    )
    print(f"Exported {args.arch} ONNX model to {args.output}")


if __name__ == "__main__":
    main()
