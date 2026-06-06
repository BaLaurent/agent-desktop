#!/usr/bin/env python3
"""
Custom wake-word training for openWakeWord (synthetic / no-recording flow).

Invoked by the Electron main service `hotwordTrainer.ts`:
    python train_wakeword.py --phrase "hey clawd" --slug hey_clawd --out <models_dir>

It must:
  - synthesize many spoken samples of the phrase with piper-sample-generator,
  - augment them and train a small openWakeWord classification head,
  - export <slug>.onnx into --out (the app then serves it via agent-model://hotword-model/).

Progress is reported to the parent on stdout as lines:  `PROGRESS <0..1> <message>`
Any other stdout/stderr is forwarded to the UI log verbatim. Exit code 0 == success.

NOTE (validate on a real machine): openWakeWord training requires PyTorch + a checkout of
rhasspy/piper-sample-generator and is Linux-only (Piper). The exact training entry points differ
slightly between openwakeword releases — the calls below follow the documented
`notebooks/automatic_model_training.ipynb` flow and are the spots to verify against the installed
version. The Electron side (spawn/stream/cancel/model serving) is engine-agnostic and already works.
"""

import argparse
import os
import sys


def progress(pct: float, message: str) -> None:
    print(f"PROGRESS {max(0.0, min(1.0, pct)):.3f} {message}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phrase", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--n-samples", type=int, default=2000)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    progress(0.02, f'Preparing to train "{args.phrase}"')

    # --- Dependency check -------------------------------------------------
    try:
        import openwakeword  # noqa: F401
        from openwakeword.train import Model as _OwwTrainModel  # type: ignore  # noqa: F401
    except Exception as e:  # pragma: no cover - real-env dependent
        print(
            "ERROR: openWakeWord training tools not available "
            f"({e}). Click 'Install tools' first, or set a Python path with the training "
            "environment installed.",
            file=sys.stderr,
            flush=True,
        )
        return 2

    # --- 1. Synthesize positive samples (Piper) ---------------------------
    progress(0.10, "Synthesizing speech samples with Piper…")
    try:
        # piper-sample-generator exposes a generate_samples entry point; the exact import
        # path depends on how it was installed (pip vs. git checkout on PYTHONPATH).
        from piper_sample_generator.generate_samples import generate_samples  # type: ignore

        positives_dir = os.path.join(args.out, f"_{args.slug}_pos")
        os.makedirs(positives_dir, exist_ok=True)
        generate_samples(
            text=args.phrase,
            max_samples=args.n_samples,
            output_dir=positives_dir,
        )
    except Exception as e:  # pragma: no cover
        print(
            "ERROR: sample generation failed. Ensure rhasspy/piper-sample-generator is installed "
            f"and on PYTHONPATH ({e}).",
            file=sys.stderr,
            flush=True,
        )
        return 3

    # --- 2. Train the wake-word head -------------------------------------
    progress(0.55, "Training wake-word model (this is the slow part)…")
    try:
        # The openWakeWord automatic-training flow computes shared features for the positive
        # clips + a bundled negative/background set, then fits a small DNN head and exports ONNX.
        # See openwakeword.train.Model — adapt arg names to the installed version if needed.
        model = _OwwTrainModel()  # type: ignore[call-arg]
        model.auto_train(  # type: ignore[attr-defined]
            positive_dir=positives_dir,
            output_dir=args.out,
            model_name=args.slug,
        )
    except Exception as e:  # pragma: no cover
        print(
            f"ERROR: training failed ({e}). Verify the openwakeword version's training API "
            "matches automatic_model_training.ipynb.",
            file=sys.stderr,
            flush=True,
        )
        return 4

    out_path = os.path.join(args.out, f"{args.slug}.onnx")
    if not os.path.exists(out_path):
        print(f"ERROR: expected model not found at {out_path}", file=sys.stderr, flush=True)
        return 5

    progress(1.0, f"Done — {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
