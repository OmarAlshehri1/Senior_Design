"""Fail-closed validation and antivirus scanning for case attachments."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf": (".pdf", lambda data: data.startswith(b"%PDF-")),
    "image/png": (".png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/jpeg": (".jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
}


def scanner_available() -> bool:
    executable = os.getenv("CASE_ANTIVIRUS_EXECUTABLE", "").strip()
    return bool(executable and (Path(executable).is_file() or shutil.which(executable)))


class EvidenceError(Exception):
    def __init__(self, code: str, status: int, reason: str | None = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.reason = reason


def validate_filename(filename: str, content_type: str, content: bytes) -> tuple[str, str]:
    safe_name = filename.replace("\\", "/").split("/")[-1].strip()
    if not safe_name or len(safe_name) > 240 or any(ord(char) < 32 or ord(char) == 127 for char in safe_name):
        raise EvidenceError("INVALID_EVIDENCE_NAME", 422, "UNSAFE_TYPE")
    entry = ALLOWED_TYPES.get(content_type.lower().split(";", 1)[0].strip())
    if entry is None:
        raise EvidenceError("UNSAFE_EVIDENCE_TYPE", 422, "UNSAFE_TYPE")
    extension, signature_check = entry
    if Path(safe_name).suffix.lower() not in ({".jpg", ".jpeg"} if extension == ".jpg" else {extension}):
        raise EvidenceError("EVIDENCE_MIME_MISMATCH", 422, "MIME_MISMATCH")
    if not content or len(content) > MAX_EVIDENCE_BYTES:
        raise EvidenceError("EVIDENCE_SIZE_LIMIT", 413, "SIZE_LIMIT")
    if not signature_check(content):
        raise EvidenceError("EVIDENCE_MIME_MISMATCH", 422, "MIME_MISMATCH")
    return safe_name, extension


def scan_clean_file(content: bytes, extension: str) -> None:
    executable = os.getenv("CASE_ANTIVIRUS_EXECUTABLE", "").strip()
    if not executable:
        raise EvidenceError("EVIDENCE_STORAGE_OR_SCANNER_UNAVAILABLE", 503)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="case-evidence-", suffix=extension, delete=False) as temporary:
            temporary.write(content)
            temporary_path = temporary.name
        result = subprocess.run(
            [executable, "--no-summary", temporary_path],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EvidenceError("EVIDENCE_STORAGE_OR_SCANNER_UNAVAILABLE", 503) from exc
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
    if result.returncode == 0:
        return
    if result.returncode == 1:
        raise EvidenceError("EVIDENCE_REJECTED_BY_SCANNER", 422, "MALWARE_DETECTED")
    raise EvidenceError("EVIDENCE_STORAGE_OR_SCANNER_UNAVAILABLE", 503)
