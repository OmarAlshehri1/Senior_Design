import asyncio
from copy import deepcopy
from decimal import Decimal
import json

import pytest
from pydantic import ValidationError

from app.services.ingestion_mapping import MappingConfiguration, validate_record
from app.services import ingestion_validation as worker
from app.repositories.supabase_transactions import SupabasePersistenceError


def config():
    return {"schema_version": "1.0", "supported_currencies": ["USD", "EUR"],
            "vendor_namespace": "supplier-master-A", "actor_namespace": "employees-A",
            "fields": {"amount": {"path": ["payment", "value"]},
                       "currency": {"path": ["payment", "unit"]},
                       "timestamp": {"path": ["occurred"], "time": {"format": "iso8601"}},
                       "vendor_id": {"path": ["supplier"]},
                       "created_by": {"path": ["creator"]},
                       "approved_by": {"path": ["reviewer"]}}}


def record():
    return {"payment": {"value": "123.4500", "unit": "USD"},
            "occurred": "2026-10-04T02:30:00+03:00", "supplier": "V-1",
            "creator": "EMP-1", "reviewer": "EMP-2", "invoice_number": "DO-NOT-GUESS",
            "ground_truth": {"is_anomaly": True}}


def validate(raw=None, mapping=None):
    return validate_record(record() if raw is None else raw,
                           MappingConfiguration.model_validate(config() if mapping is None else mapping))


def test_explicit_mapping_preserves_source_and_does_not_use_unmapped_fields():
    raw = record()
    before = deepcopy(raw)
    result = validate(raw)
    assert raw == before
    assert result["intake_status"] == "ACCEPTED"
    assert result["canonical"]["amount"] == "123.4500"
    assert result["canonical"]["timestamp"] == "2026-10-03T23:30:00+00:00"
    assert result["canonical"]["invoice_number"] is None
    assert result["identity_context"]["actor_namespace"] == "employees-A"
    assert result["authority_status"] == "UNVERIFIED"
    assert not {"ground_truth", "risk_score", "is_anomaly"} & result["canonical"].keys()


def test_independent_source_with_different_structure_uses_same_engine():
    mapping = {"schema_version": "1.0", "supported_currencies": ["EUR"], "fields": {
        "amount": {"path": ["gross_minor"], "number": {"unit_scale": "0.01"}},
        "currency": {"path": ["iso"]}, "vendor_name": {"path": ["counterparty"]},
        "timestamp": {"path": ["when"], "time": {"format": "%d/%m/%Y %H:%M:%S%z"}}}}
    result = validate({"gross_minor": 12345, "iso": "EUR", "counterparty": "Supplier",
                       "when": "04/10/2026 12:00:00+0200"}, mapping)
    assert result["intake_status"] == "ACCEPTED"
    assert result["canonical"]["amount"] == "123.45"
    assert result["canonical"]["timestamp"] == "2026-10-04T10:00:00+00:00"
    assert result["canonical"]["created_by"] is None


@pytest.mark.parametrize("value,number,expected", [
    ("1.234,56", {"decimal_separator": ",", "thousands_separator": "."}, "1234.56"),
    ("1,234.56", {"thousands_separator": ","}, "1234.56"),
    ("1 234,56", {"decimal_separator": ",", "thousands_separator": " "}, "1234.56"),
    (0, {}, "0"), (Decimal("0.123456789012345678"), {}, "0.123456789012345678"),
])
def test_declared_numeric_formats_without_rounding(value, number, expected):
    raw, mapping = record(), config()
    raw["payment"]["value"] = value
    mapping["fields"]["amount"]["number"] = number
    assert validate(raw, mapping)["canonical"]["amount"] == expected


@pytest.mark.parametrize("value,code,status", [
    (True, "NUMERIC_TYPE_INVALID", "REJECTED"), (-1, "NEGATIVE_PAYMENT_UNSUPPORTED", "REJECTED"),
    ("-12.50", "NEGATIVE_PAYMENT_UNSUPPORTED", "REJECTED"),
    (float(1.1), "NUMERIC_TYPE_INVALID", "REJECTED"),
    (Decimal("NaN"), "NUMERIC_NONFINITE", "REJECTED"),
    (Decimal("1e50"), "NUMERIC_RANGE_UNSUPPORTED", "REJECTED"),
    ("1,234", "NUMERIC_FORMAT_INVALID", "PARTIAL"),
    ("unknown", "NUMERIC_FORMAT_INVALID", "PARTIAL"),
    (None, "VALUE_MISSING", "PARTIAL"),
])
def test_incompatible_and_ambiguous_numbers_have_explicit_outcomes(value, code, status):
    raw = record()
    raw["payment"]["value"] = value
    result = validate(raw)
    assert result["intake_status"] == status
    assert {"field": "amount", "code": code} in result["reasons"]
    assert result["canonical"]["amount"] is None


@pytest.mark.parametrize("value,time,precision,saved", [
    ("2026", {"precision": "year", "format": "%Y"}, "year", "2026"),
    ("03/04/2026", {"precision": "date", "format": "%d/%m/%Y"}, "date", "2026-04-03"),
])
def test_date_precision_is_preserved_without_inventing_instant(value, time, precision, saved):
    raw, mapping = record(), config()
    raw["occurred"] = value
    mapping["fields"]["timestamp"]["time"] = time
    result = validate(raw, mapping)
    assert result["intake_status"] == "PARTIAL"
    assert result["canonical"]["timestamp"] is None
    assert result["canonical"]["source_date"] == saved
    assert result["canonical"]["time_precision"] == precision


@pytest.mark.parametrize("value,code", [
    ("2026-10-04T12:00:00", "TIMESTAMP_TIMEZONE_MISSING"),
    ("04/10/2026", "TIMESTAMP_FORMAT_INVALID"),
    ("2026-02-30T12:00:00Z", "TIMESTAMP_FORMAT_INVALID"),
    ("2026-10-04T12:00:00+03:60", "TIMESTAMP_FORMAT_INVALID"),
])
def test_ambiguous_or_invalid_time_has_no_guessed_timezone(value, code):
    raw = record()
    raw["occurred"] = value
    result = validate(raw)
    assert result["canonical"]["timestamp"] is None
    assert {"field": "timestamp", "code": code} in result["reasons"]


def test_sparse_unknown_currency_category_and_long_text():
    result = validate({})
    assert result["intake_status"] == "PARTIAL"
    assert all(value is None for value in result["canonical"].values())
    raw = record()
    raw["payment"]["unit"] = "SAR"
    result = validate(raw)
    assert result["canonical"]["currency"] is None
    assert {"field": "currency", "code": "CURRENCY_UNSUPPORTED"} in result["reasons"]
    mapping = config()
    mapping["fields"]["category"] = {"path": ["class"], "values": {"known": "Office"}}
    assert {"field": "category", "code": "CATEGORY_UNMAPPED"} in validate(record() | {"class": "new"}, mapping)["reasons"]
    raw = record() | {"supplier": "x" * 51}
    assert validate(raw)["intake_status"] == "REJECTED"


def test_no_supported_currency_declaration_does_not_create_a_default():
    mapping = config()
    mapping.pop("supported_currencies")
    result = validate(record(), mapping)
    assert result["canonical"]["currency"] is None
    assert {"field": "currency", "code": "CURRENCY_UNSUPPORTED"} in result["reasons"]


@pytest.mark.parametrize("mutate", [
    lambda m: m.update(expected_failure=True),
    lambda m: m["fields"].update(risk_score={"path": ["answer"]}),
    lambda m: m["fields"]["amount"].update(default="0"),
    lambda m: m["fields"]["amount"].update(path=["payment", "value", 1]),
    lambda m: m.update(actor_namespace=None),
    lambda m: m.update(vendor_namespace=None),
    lambda m: m["fields"]["approved_by"].update(path=["creator"]),
    lambda m: m["fields"]["amount"].update(number={"decimal_separator": ",", "thousands_separator": ","}),
    lambda m: m["fields"]["amount"].update(number={"unit_scale": "0"}),
    lambda m: m["fields"]["timestamp"].update(time={"format": "%m/%d/%y"}),
])
def test_mapping_cannot_guess_execute_code_or_inject_audit_outcomes(mutate):
    mapping = config()
    mutate(mapping)
    with pytest.raises(ValidationError):
        MappingConfiguration.model_validate(mapping)


@pytest.fixture
def validation_worker(monkeypatch):
    monkeypatch.setenv("INGESTION_ENABLED", "true")
    monkeypatch.setenv("INGESTION_VALIDATION_ENABLED", "true")
    job = {"receipt_id": "receipt", "source_id": "source-A", "lease_token": "lease",
           "configuration": config(), "mapping_version": "v1", "original_payload": json.dumps({
               "schema_version": "1.0", "source_id": "source-A", "event_id": "e", "record_id": "r",
               "event_type": "transaction.created", "original_record": record()})}
    calls = []
    queue = [job]
    def rpc(name, payload):
        calls.append((name, deepcopy(payload)))
        if name == "claim_ingestion_validation":
            return queue.pop(0) if queue else None
        if name == "finish_ingestion_validation":
            return {"validation_status": "COMPLETED"}
        if name == "release_ingestion_validation":
            return None
        raise AssertionError(name)
    monkeypatch.setattr(worker.repository, "rpc", rpc)
    return job, calls, rpc


def test_worker_commits_staging_only_and_both_flags_gate_all_calls(validation_worker, monkeypatch):
    _, calls, _ = validation_worker
    monkeypatch.setenv("INGESTION_VALIDATION_ENABLED", "false")
    assert asyncio.run(worker.validate_once()) == 0
    assert not calls
    monkeypatch.setenv("INGESTION_VALIDATION_ENABLED", "true")
    monkeypatch.setenv("INGESTION_ENABLED", "false")
    assert asyncio.run(worker.validate_once()) == 0
    monkeypatch.setenv("INGESTION_ENABLED", "true")
    assert asyncio.run(worker.validate_once()) == 1
    result = next(p["p_result"] for name, p in calls if name == "finish_ingestion_validation")
    assert result["intake_status"] == "ACCEPTED"
    assert set(name for name, _ in calls) == {"claim_ingestion_validation", "finish_ingestion_validation"}


@pytest.mark.parametrize("configuration,code", [(None, "MAPPING_NOT_CONFIGURED"), ({}, "MAPPING_INVALID")])
def test_mapping_problems_block_without_claiming_bad_source_data(validation_worker, configuration, code):
    job, calls, _ = validation_worker
    job["configuration"] = configuration
    assert asyncio.run(worker.validate_once()) == 0
    assert calls[-2][0] == "release_ingestion_validation"
    assert calls[-2][1]["p_code"] == code
    assert not any(name == "finish_ingestion_validation" for name, _ in calls)


def test_uncertain_finish_failure_releases_only_its_lease_with_safe_code(validation_worker, monkeypatch):
    _, calls, normal_rpc = validation_worker
    def rpc(name, payload):
        if name == "finish_ingestion_validation":
            raise SupabasePersistenceError("private raw diagnostic")
        return normal_rpc(name, payload)
    monkeypatch.setattr(worker.repository, "rpc", rpc)
    assert asyncio.run(worker.validate_once()) == 0
    release = next(p for name, p in calls if name == "release_ingestion_validation")
    assert release == {"p_receipt_id": "receipt", "p_lease_token": "lease", "p_code": "VALIDATION_UNAVAILABLE"}


def test_malformed_claim_does_not_kill_loop_with_unhandled_key_error(validation_worker, monkeypatch):
    monkeypatch.setattr(worker.repository, "rpc", lambda name, payload: {"unexpected": "private diagnostic"})
    with pytest.raises(SupabasePersistenceError, match="Invalid validation claim"):
        asyncio.run(worker.validate_once())


@pytest.mark.parametrize("valid", [True, False])
def test_offline_configuration_check_has_no_database_calls_or_payload_output(tmp_path, monkeypatch, capsys, valid):
    from scripts.validate_ingestion_mapping import main
    path = tmp_path / "mapping.json"
    path.write_text(json.dumps(config()) if valid else '{"secret": "do-not-print", "secret": 1}', encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["validate_ingestion_mapping", str(path)])
    def unexpected_database(*args, **kwargs):
        raise AssertionError("Offline mapping validation contacted the database")
    monkeypatch.setattr(worker.repository, "rpc", unexpected_database)
    assert main() == (0 if valid else 1)
    output = capsys.readouterr().out
    assert ("VALID_MAPPING engine=" if valid else "INVALID_MAPPING:") in output
    assert "do-not-print" not in output
    assert "employees-A" not in output
