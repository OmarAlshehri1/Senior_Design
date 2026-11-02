"""Bounded file adapters and explicit previews; never infer policy or model approval."""
import csv
from datetime import date, datetime
import hashlib
from io import BytesIO, StringIO
import json
from pathlib import PurePosixPath
from zipfile import ZipFile, BadZipFile
import xml.etree.ElementTree as ET

from openpyxl import load_workbook
from openpyxl.styles.numbers import is_datetime
from openpyxl.utils.exceptions import InvalidFileException

from app.services.ingestion_mapping import MappingConfiguration, validate_record
from app.services.ingestion_payload import IDENTIFIER, MAX_BODY, check_value
from app.services.rule_eligibility import evaluate_rule_eligibility

MAX_FILE = 25 * 1024 * 1024
MAX_ROWS = 50_000
MAX_COLUMNS = 64
MAX_EXPANDED_ROWS = 64 * 1024 * 1024
MAX_EXPANDED_WORKBOOK = 128 * 1024 * 1024


class ImportProblem(ValueError):
    pass


def _table(rows):
    try:
        headers = next(rows)
    except StopIteration:
        raise ImportProblem("The file is empty.") from None
    if not headers or len(headers) > MAX_COLUMNS or any(not isinstance(h, str) or not h.strip() for h in headers):
        raise ImportProblem("Use a header row with 1 to 64 non-empty column names.")
    headers = [h.strip() for h in headers]
    if len(set(headers)) != len(headers) or any(len(h) > 128 for h in headers):
        raise ImportProblem("Column names must be unique and at most 128 characters.")
    records = []
    total_size = 0
    for row_number, values in enumerate(rows, 2):
        if not any(v is not None and v != "" for v in values):
            continue
        if len(records) >= MAX_ROWS:
            raise ImportProblem(f"Upload at most {MAX_ROWS:,} data rows per file.")
        if len(values) != len(headers):
            raise ImportProblem(f"Row {row_number} does not match the header columns.")
        record = dict(zip(headers, values))
        record_size = len(json.dumps(record, ensure_ascii=False).encode("utf-8"))
        if record_size > MAX_BODY - 2048:
            raise ImportProblem(f"Row {row_number} is too large for a transaction receipt.")
        total_size += record_size
        if total_size > MAX_EXPANDED_ROWS:
            raise ImportProblem("The expanded row data is too large. Split the file into smaller batches.")
        try:
            check_value(record)
        except (ValueError, RecursionError):
            raise ImportProblem(f"Row {row_number} has an unsupported or oversized value.") from None
        records.append({"row": row_number, "record": record})
    if not records:
        raise ImportProblem("The selected sheet has no data rows.")
    return headers, records


def parse_file(content: bytes, filename: str, sheet: str | None = None):
    if not content or len(content) > MAX_FILE:
        raise ImportProblem(f"Upload a non-empty file no larger than {MAX_FILE // (1024 * 1024)} MiB.")
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    if len(filename) > 200:
        raise ImportProblem("The filename is too long.")
    suffix = PurePosixPath(filename).suffix.lower()
    sheets = []
    selected = None
    try:
        if suffix == ".csv":
            if sheet is not None:
                raise ImportProblem("CSV files do not have worksheets.")
            text = content.decode("utf-8-sig")
            if "\x00" in text:
                raise ImportProblem("CSV must be UTF-8 text.")
            headers, records = _table(iter(csv.reader(StringIO(text, newline=""), strict=True)))
        elif suffix == ".xlsx":
            with ZipFile(BytesIO(content)) as archive:
                names = archive.namelist()
                if len(names) > 1000 or sum(i.file_size for i in archive.infolist()) > MAX_EXPANDED_WORKBOOK:
                    raise ImportProblem("The expanded workbook is too large.")
                if len(names) != len(set(names)) or any("vbaproject" in n.lower() or "externallinks/" in n.lower() for n in names):
                    raise ImportProblem("Macros and external workbook links are not supported.")
                # Reject entity declarations before openpyxl reads any XML.
                for name in names:
                    if name.endswith(".xml"):
                        raw = archive.read(name)
                        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                            raise ImportProblem("Unsupported workbook XML.")
                raw = None
                workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
                try:
                    sheets = workbook.sheetnames
                    if len(sheets) > 20:
                        raise ImportProblem("Upload a workbook with at most 20 sheets.")
                    selected = sheet or sheets[0]
                    if selected not in sheets:
                        raise ImportProblem("Choose a sheet listed in the workbook.")
                    worksheet = workbook[selected]
                    # Resolve the worksheet's archive path from the reader, never a client path.
                    lexemes = {}
                    # Stream only the chosen sheet; avoid a full XML tree or maps
                    # for unrelated sheets while retaining exact numeric lexemes.
                    with archive.open(worksheet._worksheet_path) as stream:
                        for _, cell in ET.iterparse(stream, events=('end',)):
                            if cell.tag.endswith('}c'):
                                value = cell.find('{*}v')
                                if cell.get('t', 'n') == 'n' and value is not None:
                                    lexemes[cell.get('r')] = value.text
                                cell.clear()
                            elif cell.tag.endswith('}row'):
                                cell.clear()
                    def values():
                        for row in worksheet.iter_rows():
                            if len(row) > MAX_COLUMNS:
                                raise ImportProblem("A sheet may have at most 64 columns.")
                            converted = []
                            for cell in row:
                                if cell.data_type in ("f", "e"):
                                    raise ImportProblem("Replace spreadsheet formulas/errors with exported values before uploading.")
                                value = cell.value
                                if isinstance(value, datetime) and is_datetime(cell.number_format) == 'date':
                                    value = value.date().isoformat()
                                elif isinstance(value, (datetime, date)):
                                    value = value.isoformat()
                                elif cell.data_type == "n" and value is not None:
                                    value = lexemes.get(cell.coordinate)
                                    if value is None:
                                        raise ImportProblem("A numeric cell could not be read without precision loss.")
                                converted.append(value)
                            yield converted
                    headers, records = _table(iter(values()))
                finally:
                    workbook.close()
        else:
            raise ImportProblem("Supported files are CSV (.csv) and Excel (.xlsx).")
    except ImportProblem:
        raise
    except (UnicodeError, csv.Error, BadZipFile, InvalidFileException, ET.ParseError, KeyError, ValueError, OSError, IndexError, TypeError, RuntimeError):
        raise ImportProblem("The file could not be read. Use UTF-8 CSV or a valid XLSX workbook.") from None
    return {"filename": filename, "file_hash": hashlib.sha256(content).hexdigest(),
            "sheet": selected, "sheets": sheets, "columns": headers, "records": records}


def build_preview(document, configuration: MappingConfiguration, identity_column: str):
    columns = document["columns"]
    if identity_column not in columns or any(len(v.path) != 1 or v.path[0] not in columns for v in configuration.fields.values()):
        raise ImportProblem("Choose columns from this file for the transaction reference and mapped fields.")
    seen = set()
    rows, examples, issues = [], [], []
    counts = {"ACCEPTED": 0, "PARTIAL": 0, "REJECTED": 0}
    for entry in document["records"]:
        record = entry["record"]
        result = validate_record(record, configuration)
        record_id = record.get(identity_column)
        if not isinstance(record_id, str) or not IDENTIFIER.fullmatch(record_id) or record_id in seen:
            result["intake_status"] = "REJECTED"
            result["reasons"].append({"field": "record_id", "code": "REFERENCE_MISSING_INVALID_OR_REPEATED"})
        seen.add(record_id)
        # Missing values allow partial evaluation. Invalid declared values require correction.
        allowed = {"VALUE_MISSING", "FIELD_NOT_MAPPED", "VENDOR_IDENTITY_UNAVAILABLE", "TIMESTAMP_PRECISION_INSUFFICIENT"}
        if any(r["code"] not in allowed for r in result["reasons"]):
            result["intake_status"] = "REJECTED"
        counts[result["intake_status"]] += 1
        if result["intake_status"] == "REJECTED" and len(issues) < 100:
            issues.append({"row": entry["row"], "reasons": result["reasons"]})
        rows.append({"row": entry["row"], "record_id": record_id, "original_record": record})
        if len(examples) < 10:
            examples.append({"row": entry["row"], "record_id": record_id, **result,
                "field_eligibility": evaluate_rule_eligibility(result['canonical'])})
    config = configuration.model_dump(mode="json")
    revision = hashlib.sha256(json.dumps({"file": document["file_hash"], "sheet": document["sheet"],
        "mapping": config, "identity": identity_column}, sort_keys=True).encode()).hexdigest()
    return {"mapping": config, "identity_column": identity_column, "revision": revision,
            "counts": counts, "examples": examples, "rows": rows, "issues": issues}
