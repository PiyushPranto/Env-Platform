"""
TEMPLATE — copy this file to one of:
    scripts/models/heat_export.py
    scripts/models/flood_export.py
    scripts/models/deforestation_export.py

and fill in generate() with your REAL model/notebook code (adapted from
Colab). This is the only file you need to add per model to make that
model's automation real instead of "unavailable".

Contract your generate() function must follow:

    def generate(staging_dir: Path) -> None:
        ...

- staging_dir is an empty temporary directory the orchestrator created for
  this run. Write your model's real output files directly into it, using
  the EXACT SAME filenames api/index.py already reads from api/data/ —
  e.g. for heat: heat_risk.json, heat_trend.json, heat_grid.json,
  heat_hotspots.geojson. Check scripts/runners/<model>.py's OUTPUT_FILES
  list for the exact filenames expected.
- Use the exact same field names/shapes the current api/data/*.json files
  use (see README.md's endpoint -> file -> field mapping, and the
  docstrings in api/index.py) so the frontend needs zero changes.
- Do NOT write to api/data/ directly. The orchestrator only promotes files
  from staging_dir to api/data/ after every file passes validation
  (scripts/validators.py). This is what protects the live dashboard from a
  partially-broken run.
- Raise a normal Python exception on any real failure (missing
  credentials, GEE export error, model training error, etc.) — do NOT
  catch it and silently write partial/fake output. The orchestrator will
  correctly record this as a failed run and leave the previous good
  output in place. Do not return successfully unless your real files are
  actually written and correct.
- Do NOT invent numbers, interpolate placeholder values, or hardcode
  "example" output "just to make the pipeline pass". If your model can't
  currently run headlessly (e.g. it depends on an interactive GEE Code
  Editor export to your personal Drive), that's a real limitation — fix
  the export path (e.g. switch to the `earthengine-api` Python client with
  a service account, exporting to Google Cloud Storage) rather than
  working around it with fake data here.

Example skeleton (adapt heavily — this is illustrative, not real model code):

    from pathlib import Path
    import json

    def generate(staging_dir: Path) -> None:
        # 1. Load your real trained model / re-run your real pipeline.
        #    e.g. clf = joblib.load(Path(__file__).parent / "artifacts" / "model.joblib")
        #
        # 2. Pull fresh input data (rainfall, NDVI, etc.) for this run —
        #    from GEE, an API, a cached extract, whatever your real
        #    pipeline actually uses.
        #
        # 3. Run real inference / real aggregation. NO random.random(),
        #    NO copy-pasted "sample" numbers.
        #
        # 4. Write real output, matching the existing schema exactly:
        result = {"...": "..."}  # replace with your real computed result
        (staging_dir / "heat_risk.json").write_text(json.dumps(result))

    if __name__ == "__main__":
        # Lets you test generate() locally: `python heat_export.py`
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            generate(Path(tmp))
            print("Wrote:", list(Path(tmp).iterdir()))
"""

from pathlib import Path


def generate(staging_dir: Path) -> None:  # noqa: ARG001 - template stub
    raise NotImplementedError(
        "This is the template file, not a real export script. Copy it to "
        "heat_export.py / flood_export.py / deforestation_export.py and "
        "implement generate() with your real model code."
    )
