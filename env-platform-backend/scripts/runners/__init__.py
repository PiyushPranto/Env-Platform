"""
Per-model runner plug-ins for the automation pipeline.

Each runner (heat.py, flood.py, deforestation.py) is responsible for one
thing: producing fresh output files for its model into a staging directory
by calling the user's real model code — and nothing else. Runners never
touch api/data/ directly (the orchestrator does that, only after
validation) and never invent numbers.

Two exceptions carry the two honest outcomes a runner can have besides
success:

- ModelUnavailable: there is no real model export script wired in yet for
  this model. This is expected and NOT a failure — it means "nothing to
  do here until you provide the real code," and the orchestrator logs it
  as "skipped", not "failed". This is the mechanism that satisfies the
  explicit requirement: never fake a placeholder as if it were a working
  pipeline.
- ModelRunFailed: real model code exists and was invoked, but it raised an
  error or produced no usable output. The orchestrator logs this as
  "failed" and — critically — still leaves the previous valid api/data/
  files untouched.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path


class ModelUnavailable(Exception):
    """No real model code is wired in yet for this model.

    Raise this with a specific, actionable message naming exactly what file
    or credential is missing (e.g. "scripts/models/heat_export.py does not
    exist — no Heat model code has been provided"). The orchestrator treats
    this as a normal, expected "skipped" outcome, not an error.
    """


class ModelRunFailed(Exception):
    """Real model code exists and ran, but failed or produced no usable output.

    Raise this with the underlying error/context. The orchestrator logs
    this as a failed run for this model and does not touch the existing
    live output files.
    """


MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def run_export_module(model_name: str, staging_dir: Path) -> None:
    """Load scripts/models/<model_name>_export.py and call its generate().

    This is the single place that implements the plug-in convention shared
    by heat.py / flood.py / deforestation.py, so all three models behave
    identically and consistently:

    1. If scripts/models/<model_name>_export.py does not exist, raise
       ModelUnavailable naming that exact missing file — this is the
       "clearly identify as a missing dependency, do not fake it" path.
    2. If it exists but has no generate(staging_dir) function, raise
       ModelUnavailable explaining the file is malformed (still not a
       fabricated result).
    3. If it exists and generate() raises, wrap the error as
       ModelRunFailed so the orchestrator knows this was a real, failed
       attempt (not "unavailable") and logs it accordingly.
    4. If generate() returns normally, this function returns normally —
       the runner is expected to have written real output files into
       staging_dir itself. It is the model author's responsibility that
       generate() writes real files there; this function never invents
       output on the model's behalf.
    """
    script_path = MODELS_DIR / f"{model_name}_export.py"

    if not script_path.exists():
        raise ModelUnavailable(
            f"No model code found: {script_path.relative_to(MODELS_DIR.parent.parent)} "
            f"does not exist. Add a real export script there (see "
            f"scripts/models/_template_export.py) with a generate(staging_dir) "
            f"function that runs the actual {model_name} model and writes its "
            f"real output files into staging_dir. Until that file exists, this "
            f"model is intentionally skipped rather than faked."
        )

    spec = importlib.util.spec_from_file_location(f"{model_name}_export", script_path)
    if spec is None or spec.loader is None:
        raise ModelUnavailable(f"Could not load {script_path.name} as a Python module.")

    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as e:  # noqa: BLE001 - surfaced as a failed run, not silently swallowed
        raise ModelRunFailed(f"{script_path.name} raised an error while loading: {e}") from e

    generate = getattr(module, "generate", None)
    if generate is None or not callable(generate):
        raise ModelUnavailable(
            f"{script_path.name} exists but has no callable generate(staging_dir) "
            f"function — see scripts/models/_template_export.py for the expected shape."
        )

    try:
        generate(staging_dir)
    except Exception as e:  # noqa: BLE001 - this is a real model run failing, log it as such
        raise ModelRunFailed(f"{script_path.name}'s generate() raised: {e}") from e
