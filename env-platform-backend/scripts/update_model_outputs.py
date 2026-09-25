#!/usr/bin/env python3
"""
Orchestrator for the model-output-update automation.

What this does, every time it runs (every 3 days via GitHub Actions, or
manually via `python scripts/update_model_outputs.py`):

    for each model in (heat, flood, deforestation):
        1. Create a fresh, empty staging directory for that model.
        2. Call that model's runner (scripts/runners/<model>.py), which in
           turn looks for scripts/models/<model>_export.py and runs its
           generate(staging_dir) function.
        3. Three possible outcomes:
             - ModelUnavailable  -> no real model code wired in yet.
               Logged as SKIPPED. Not an error. Existing api/data/ files
               for this model are left completely untouched.
             - ModelRunFailed (or any file failing validation)
               -> real code exists and ran, but errored or produced bad
               output. Logged as FAILED, with the real error message.
               Existing api/data/ files for this model are left completely
               untouched.
             - Success + every expected output file passes validation
               -> the staged files are copied into api/data/, replacing
               the old ones. Logged as UPDATED.
    Finally, api/data/refresh_status.json is rewritten with the outcome of
    this run for every model, preserving each model's last successful
    "last_updated" timestamp across skipped/failed runs.

This script never fabricates output. If nothing is wired in for any
model, every model is logged as "skipped" and no api/data/ file changes —
that is the correct, honest behavior, not a bug.

Exit code is always 0 unless the script itself is broken (an unexpected
Python exception outside the per-model try/except) — per-model failures
are recorded in refresh_status.json and in the log, not surfaced as a
nonzero exit, so a broken model doesn't stop the workflow from committing
the refresh_status.json update for the models that DID succeed. Use
--strict to exit nonzero if any model failed (not skipped, only failed) —
useful for alerting without ever discarding good output.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # allow `scripts.*` imports when run directly

from scripts.runners import ModelRunFailed, ModelUnavailable  # noqa: E402
from scripts.runners import heat as heat_runner  # noqa: E402
from scripts.runners import flood as flood_runner  # noqa: E402
from scripts.runners import flood_projection as flood_projection_runner  # noqa: E402
from scripts.runners import deforestation as deforestation_runner  # noqa: E402
from scripts.validators import validate_file  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "api" / "data"
REFRESH_STATUS_PATH = DATA_DIR / "refresh_status.json"

MODELS = {
    "heat": (heat_runner.run, heat_runner.OUTPUT_FILES),
    "flood": (flood_runner.run, flood_runner.OUTPUT_FILES),
    "flood_projection": (flood_projection_runner.run, flood_projection_runner.OUTPUT_FILES),
    "deforestation": (deforestation_runner.run, deforestation_runner.OUTPUT_FILES),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_refresh_status() -> dict:
    if REFRESH_STATUS_PATH.exists():
        try:
            return json.loads(REFRESH_STATUS_PATH.read_text())
        except json.JSONDecodeError:
            pass  # corrupt status file — rebuild fresh rather than crash the run
    return {"models": {}, "last_run_at": None, "last_run_had_updates": False, "last_run_had_failures": False}


def run_one_model(name: str, runner_fn, output_files: list[str]) -> dict:
    """Run one model's export, validate its output, and promote it if (and
    only if) every expected file is present and valid. Returns a status
    dict for refresh_status.json. Never raises."""
    print(f"\n=== {name} ===")

    with tempfile.TemporaryDirectory(prefix=f"{name}_staging_") as tmp:
        staging_dir = Path(tmp)

        try:
            runner_fn(staging_dir)
        except ModelUnavailable as e:
            print(f"[{name}] SKIPPED (no model code wired in yet): {e}")
            return {"status": "skipped", "reason": str(e), "checked_at": _now_iso()}
        except ModelRunFailed as e:
            print(f"[{name}] FAILED (model ran but errored): {e}")
            return {"status": "failed", "reason": str(e), "checked_at": _now_iso()}
        except Exception as e:  # noqa: BLE001 - any other unexpected error is still "failed", not a crash
            print(f"[{name}] FAILED (unexpected error): {e}")
            traceback.print_exc()
            return {"status": "failed", "reason": f"unexpected error: {e}", "checked_at": _now_iso()}

        # Validate every expected output file before touching anything live.
        problems = []
        for filename in output_files:
            staged_path = staging_dir / filename
            ok, reason = validate_file(staged_path)
            if ok:
                print(f"[{name}] validated {filename}: OK")
            else:
                print(f"[{name}] validated {filename}: INVALID — {reason}")
                problems.append(f"{filename}: {reason}")

        if problems:
            reason = "output failed validation: " + "; ".join(problems)
            print(f"[{name}] FAILED (validation) — leaving previous api/data/ files untouched")
            return {"status": "failed", "reason": reason, "checked_at": _now_iso()}

        # Every file valid — promote staged files into api/data/ atomically
        # per-file (copy to a temp name, then replace) so a crash mid-copy
        # can't leave a half-written file live.
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        for filename in output_files:
            src = staging_dir / filename
            dst = DATA_DIR / filename
            tmp_dst = dst.with_suffix(dst.suffix + ".tmp")
            shutil.copyfile(src, tmp_dst)
            tmp_dst.replace(dst)
        print(f"[{name}] UPDATED — {len(output_files)} file(s) refreshed in api/data/")
        return {"status": "success", "reason": None, "checked_at": _now_iso(), "last_updated": _now_iso()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--strict", action="store_true",
        help="Exit with a nonzero status if any model FAILED (skipped models don't count).",
    )
    args = parser.parse_args()

    status = _load_refresh_status()
    models_status = status.get("models", {})

    any_updates = False
    any_failures = False

    for name, (runner_fn, output_files) in MODELS.items():
        result = run_one_model(name, runner_fn, output_files)

        # Preserve the last known-good "last_updated" timestamp across
        # skipped/failed runs — a skip or failure must never make the
        # dashboard's "last updated" info regress or disappear.
        previous = models_status.get(name, {})
        if result["status"] != "success":
            result["last_updated"] = previous.get("last_updated")

        models_status[name] = result

        if result["status"] == "success":
            any_updates = True
        elif result["status"] == "failed":
            any_failures = True

    status["models"] = models_status
    status["last_run_at"] = _now_iso()
    status["last_run_had_updates"] = any_updates
    status["last_run_had_failures"] = any_failures

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    REFRESH_STATUS_PATH.write_text(json.dumps(status, indent=2) + "\n")

    print("\n=== summary ===")
    for name, result in models_status.items():
        print(f"  {name}: {result['status']}" + (f" — {result['reason']}" if result.get("reason") else ""))
    print(f"refresh_status.json written to {REFRESH_STATUS_PATH}")

    if args.strict and any_failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
