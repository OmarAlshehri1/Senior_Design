"""Explicit source mappings only: no column guessing, file-specific branches or scoring."""
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAPPING_ENGINE_VERSION = "1.0.0"
TEXT_LIMITS = {"vendor_id": 50, "vendor_name": 150, "invoice_number": 50,
               "category": 100, "created_by": 50, "approved_by": 50, "approver_role": 100}
FIELDS = frozenset(TEXT_LIMITS) | {"timestamp", "amount", "currency", "approval_limit"}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class NumberFormat(StrictModel):
    decimal_separator: Literal[".", ","] = "."
    thousands_separator: Literal[".", ",", " "] | None = None
    unit_scale: str = Field(default="1", pattern=r"^(?:[1-9][0-9]{0,5}|0)(?:\.[0-9]{1,6})?$")

    @model_validator(mode="after")
    def distinct_separators(self):
        if self.decimal_separator == self.thousands_separator or Decimal(self.unit_scale) <= 0:
            raise ValueError("Invalid number format")
        return self


class TimeFormat(StrictModel):
    precision: Literal["instant", "date", "year"] = "instant"
    format: str = "iso8601"

    @model_validator(mode="after")
    def explicit_format(self):
        if self.format == "iso8601":
            if self.precision != "instant":
                raise ValueError("ISO instant format requires instant precision")
            return self
        # Only numeric date/time directives; no locale names, two-digit years or inferred zone.
        remainder = re.sub(r"%[YmdHMSfz]", "", self.format)
        if not re.fullmatch(r"[ /:T.\-]*", remainder) or "%Y" not in self.format:
            raise ValueError("Unsupported time format")
        if self.precision == "year" and self.format != "%Y":
            raise ValueError("Year precision requires %Y")
        if self.precision == "date" and (not all(p in self.format for p in ("%m", "%d"))
                                         or any(p in self.format for p in ("%H", "%M", "%S", "%f", "%z"))):
            raise ValueError("Invalid date format")
        if self.precision == "instant" and not all(p in self.format for p in ("%m", "%d", "%H", "%M")):
            raise ValueError("Instant format needs date and time")
        return self


class FieldMapping(StrictModel):
    path: list[str] = Field(min_length=1, max_length=4)
    number: NumberFormat | None = None
    time: TimeFormat | None = None
    values: dict[str, str] | None = None

    @model_validator(mode="after")
    def bounded_keys(self):
        if any(not part or len(part) > 128 for part in self.path):
            raise ValueError("Invalid source path")
        if self.values is not None and (len(self.values) > 256 or any(
                not k or not v or len(k) > 128 or len(v) > 100 for k, v in self.values.items())):
            raise ValueError("Invalid category dictionary")
        return self


class MappingConfiguration(StrictModel):
    schema_version: Literal["1.0"]
    fields: dict[str, FieldMapping] = Field(min_length=1, max_length=12)
    supported_currencies: list[str] = Field(default_factory=list, max_length=64)
    actor_namespace: str | None = Field(default=None, min_length=1, max_length=128)
    vendor_namespace: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def allowed_operations(self):
        if not set(self.fields) <= FIELDS:
            raise ValueError("Unknown canonical field")
        if len(set(self.supported_currencies)) != len(self.supported_currencies) or any(
                not re.fullmatch(r"[A-Z]{3}", code) for code in self.supported_currencies):
            raise ValueError("Invalid supported currency list")
        if {"created_by", "approved_by"} & set(self.fields) and not self.actor_namespace:
            raise ValueError("Actor identity namespace required")
        if "vendor_id" in self.fields and not self.vendor_namespace:
            raise ValueError("Vendor identity namespace required")
        paths = [tuple(spec.path) for spec in self.fields.values()]
        if len(set(paths)) != len(paths):
            raise ValueError("A source value cannot silently acquire two business meanings")
        for field, spec in self.fields.items():
            if (spec.number is not None and field not in {"amount", "approval_limit"}
                    or spec.time is not None and field != "timestamp"
                    or spec.values is not None and field != "category"
                    or field == "timestamp" and spec.time is None):
                raise ValueError("Incompatible mapping operation")
        return self


def read_path(record: dict[str, Any], path: list[str]) -> Any:
    value: Any = record
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def parse_number(value: Any, spec: NumberFormat) -> str:
    if isinstance(value, bool) or isinstance(value, float) or not isinstance(value, (str, int, Decimal)):
        raise ValueError("NUMERIC_TYPE_INVALID")
    if isinstance(value, str):
        text = value.strip()
        decimal = re.escape(spec.decimal_separator)
        if spec.thousands_separator:
            group = re.escape(spec.thousands_separator)
            integer = rf"(?:[0-9]+|[0-9]{{1,3}}(?:{group}[0-9]{{3}})+)"
        else:
            integer = r"[0-9]+"
        if not re.fullmatch(rf"[+-]?{integer}(?:{decimal}[0-9]+)?", text):
            # Ambiguous text is retained in original record, not guessed or made zero.
            raise ValueError("NUMERIC_FORMAT_INVALID")
        if spec.thousands_separator:
            text = text.replace(spec.thousands_separator, "")
        text = text.replace(spec.decimal_separator, ".")
        number = Decimal(text)
    else:
        number = Decimal(value)
    if not number.is_finite():
        raise ValueError("NUMERIC_NONFINITE")
    if number < 0:
        raise ValueError("NEGATIVE_PAYMENT_UNSUPPORTED")
    if len(number.as_tuple().digits) > 38 or abs(number.adjusted()) > 18:
        raise ValueError("NUMERIC_RANGE_UNSUPPORTED")
    with localcontext() as context:
        context.prec = 80
        number *= Decimal(spec.unit_scale)
    if len(number.as_tuple().digits) > 38 or abs(number.adjusted()) > 18:
        raise ValueError("NUMERIC_RANGE_UNSUPPORTED")
    return format(number, "f")


def parse_time(value: Any, spec: TimeFormat) -> tuple[str | None, str | None, str]:
    if not isinstance(value, str):
        raise ValueError("TIMESTAMP_TYPE_INVALID")
    text = value.strip()
    if spec.format == "iso8601":
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
                            r"(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})?", text):
            raise ValueError("TIMESTAMP_FORMAT_INVALID")
        if re.search(r"[+-][0-9]{2}:[0-9]{2}$", text) and (int(text[-5:-3]) > 23 or int(text[-2:]) > 59):
            raise ValueError("TIMESTAMP_FORMAT_INVALID")
        try:
            instant = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("TIMESTAMP_FORMAT_INVALID") from None
    else:
        try:
            instant = datetime.strptime(text, spec.format)
        except ValueError:
            raise ValueError("TIMESTAMP_FORMAT_INVALID") from None
        if spec.precision == "year":
            return None, f"{instant.year:04d}", "year"
        if spec.precision == "date":
            return None, instant.date().isoformat(), "date"
    if instant.tzinfo is None:
        raise ValueError("TIMESTAMP_TIMEZONE_MISSING")
    try:
        return instant.astimezone(timezone.utc).isoformat(), None, "instant"
    except (ValueError, OverflowError):
        raise ValueError("TIMESTAMP_RANGE_UNSUPPORTED") from None


def validate_record(original: dict[str, Any], configuration: MappingConfiguration) -> dict[str, Any]:
    """Produce a staging result only. No inference of identities, approval authority or risk."""
    canonical: dict[str, Any] = {field: None for field in sorted(FIELDS)}
    canonical.update(source_date=None, time_precision=None)
    reasons: list[dict[str, str]] = []
    rejected = False
    for field, spec in configuration.fields.items():
        value = read_path(original, spec.path)
        if value is None or isinstance(value, str) and not value.strip():
            reasons.append({"field": field, "code": "VALUE_MISSING"})
            continue
        try:
            if field in {"amount", "approval_limit"}:
                canonical[field] = parse_number(value, spec.number or NumberFormat())
            elif field == "timestamp":
                timestamp, source_date, precision = parse_time(value, spec.time)
                canonical.update(timestamp=timestamp, source_date=source_date, time_precision=precision)
                if precision != "instant":
                    reasons.append({"field": field, "code": "TIMESTAMP_PRECISION_INSUFFICIENT"})
            else:
                if not isinstance(value, str):
                    raise ValueError("TEXT_TYPE_INVALID")
                text = value.strip()
                if field == "currency":
                    if not re.fullmatch(r"[A-Z]{3}", text):
                        raise ValueError("CURRENCY_FORMAT_INVALID")
                    if text not in configuration.supported_currencies:
                        raise ValueError("CURRENCY_UNSUPPORTED")
                elif field == "category" and spec.values is not None:
                    if text not in spec.values:
                        raise ValueError("CATEGORY_UNMAPPED")
                    text = spec.values[text]
                if len(text) > TEXT_LIMITS.get(field, 3):
                    raise ValueError("TEXT_TOO_LONG")
                canonical[field] = text
        except (ValueError, InvalidOperation) as exc:
            code = str(exc) if isinstance(exc, ValueError) else "NUMERIC_FORMAT_INVALID"
            reasons.append({"field": field, "code": code})
            if code in {"NEGATIVE_PAYMENT_UNSUPPORTED", "NUMERIC_NONFINITE", "NUMERIC_TYPE_INVALID",
                        "NUMERIC_RANGE_UNSUPPORTED", "TEXT_TYPE_INVALID", "TEXT_TOO_LONG", "TIMESTAMP_TYPE_INVALID"}:
                rejected = True
    missing = [field for field in sorted(FIELDS) if canonical[field] is None]
    # Minimal useful business record; optional actor/authority absence never becomes invented data.
    for field in ("amount", "currency", "timestamp"):
        if canonical[field] is None and not any(r["field"] == field for r in reasons):
            reasons.append({"field": field, "code": "FIELD_NOT_MAPPED"})
    if canonical["vendor_id"] is None and canonical["vendor_name"] is None:
        reasons.append({"field": "vendor", "code": "VENDOR_IDENTITY_UNAVAILABLE"})
    return {
        "engine_version": MAPPING_ENGINE_VERSION,
        "intake_status": "REJECTED" if rejected else "PARTIAL" if reasons else "ACCEPTED",
        "canonical": canonical,
        "reasons": reasons,
        "missing_fields": missing,
        "identity_context": {"actor_namespace": configuration.actor_namespace,
                             "vendor_namespace": configuration.vendor_namespace},
        "authority_status": "UNVERIFIED",
        "field_paths": {field: spec.path for field, spec in configuration.fields.items()},
    }
