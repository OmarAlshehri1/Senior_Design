"""Offline configuration check. No database/network access or configuration writes."""
import argparse
import json
from pathlib import Path

from pydantic import ValidationError

from app.services.ingestion_mapping import MappingConfiguration, MAPPING_ENGINE_VERSION
from app.services.ingestion_payload import object_without_duplicates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mapping", type=Path)
    args = parser.parse_args()
    try:
        with args.mapping.open("rb") as handle:
            payload = handle.read(65537)
        if len(payload) > 65536:
            raise ValueError("Mapping exceeds 64 KiB")
        config = MappingConfiguration.model_validate(json.loads(payload.decode("utf-8"),
            object_pairs_hook=object_without_duplicates))
    except (OSError, ValueError, UnicodeError, RecursionError, ValidationError):
        print("INVALID_MAPPING: check version, explicit paths, formats and identity namespaces.")
        return 1
    print(f"VALID_MAPPING engine={MAPPING_ENGINE_VERSION} fields={len(config.fields)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
