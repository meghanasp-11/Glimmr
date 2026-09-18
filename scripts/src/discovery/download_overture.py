#!/usr/bin/env python3
"""Download Overture Places for Glimmr V1 service areas (raw snapshot).

Reads area bounds from data/production/*.json (files carrying a serviceArea
with bounds), queries the current Overture Places release with the official
`overturemaps` Python client, and writes one raw snapshot per area. No
filtering here beyond the bbox — normalization and relevance filters live in
scripts/src/discovery/overture.ts. No Nominatim/Google/food-delivery/paid
APIs are touched; only Overture's public S3 GeoParquet is read.

Usage:
    pip install -r scripts/src/discovery/requirements.txt
    python scripts/src/discovery/download_overture.py [--areas-dir DIR] [--out-dir DIR] [--release YYYY-MM-DD]

Output per area: data/discovery/raw/<area>.overture.json =
    { source, overture_release, service_area, bbox, fetched_at_utc,
      columns, record_count, records: [...] }
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AREAS_DIR = REPO_ROOT / "data" / "production"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "discovery" / "raw"

# Overture Places columns preserved in the snapshot (when present).
PRESERVED_COLUMNS = [
    "id",
    "names",
    "categories",
    "basic_category",
    "taxonomy",
    "addresses",
    "websites",
    "operating_status",
    "confidence",
    "sources",
    "brand",
    "version",
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--areas-dir", default=str(DEFAULT_AREAS_DIR))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument(
        "--release",
        default=None,
        help="Overture release date (default: latest available release)",
    )
    return parser.parse_args(argv)


def load_areas(areas_dir: Path) -> list[dict]:
    areas = []
    for path in sorted(areas_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"skip {path.name}: unreadable ({exc})", file=sys.stderr)
            continue
        area = payload.get("serviceArea") if isinstance(payload, dict) else None
        if not isinstance(area, dict) or not area.get("id"):
            continue  # not an area file (e.g. merged output)
        bounds = area.get("bounds")
        if not isinstance(bounds, dict) or not all(
            isinstance(bounds.get(k), (int, float)) for k in ("west", "south", "east", "north")
        ):
            print(f"skip {path.name}: serviceArea '{area.get('id')}' has no usable bounds")
            continue
        areas.append({"id": area["id"], "bounds": bounds})
    return areas


def point_from_wkb(value: object) -> tuple[float | None, float | None]:
    if value is None:
        return None, None
    try:
        from shapely import from_wkb

        geom = from_wkb(bytes(value))
        if geom is not None and geom.geom_type == "Point":
            return float(geom.x), float(geom.y)
    except Exception:
        pass
    return None, None


def fetch_places(bbox: tuple[float, float, float, float], release: str) -> tuple[list[str], list[dict]]:
    import overturemaps

    reader = overturemaps.core.record_batch_reader("place", bbox=bbox, release=release)
    if reader is None:
        raise RuntimeError("overturemaps returned no reader for the bbox query")
    columns = list(reader.schema.names)
    records: list[dict] = []
    for batch in reader:
        for row in batch.to_pylist():
            lng, lat = point_from_wkb(row.get("geometry"))
            record = {key: row.get(key) for key in PRESERVED_COLUMNS if key in row}
            record["overture_id"] = row.get("id")
            record["geometry"] = {"lng": lng, "lat": lat}
            record["bbox"] = row.get("bbox")
            records.append(record)
    return columns, records


def main(argv: list[str]) -> int:
    import overturemaps

    args = parse_args(argv)
    areas = load_areas(Path(args.areas_dir))
    if not areas:
        print(f"no area files with bounds found in {args.areas_dir}", file=sys.stderr)
        return 1

    release = args.release
    if not release:
        _, release = overturemaps.core.get_available_releases()
        print(f"using latest Overture release: {release}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    total = 0
    for area in areas:
        bounds = area["bounds"]
        bbox = (bounds["west"], bounds["south"], bounds["east"], bounds["north"])
        columns, records = fetch_places(bbox, release)
        snapshot = {
            "source": "overture_places",
            "overture_release": release,
            "service_area": area["id"],
            "bbox": {"xmin": bbox[0], "ymin": bbox[1], "xmax": bbox[2], "ymax": bbox[3]},
            "fetched_at_utc": fetched_at,
            "columns": columns,
            "record_count": len(records),
            "records": records,
        }
        out_path = out_dir / f"{area['id']}.overture.json"
        out_path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        total += len(records)
        print(f"{area['id']}: {len(records)} records -> {out_path}")
    print(f"done: {total} records across {len(areas)} area(s), release {release}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
