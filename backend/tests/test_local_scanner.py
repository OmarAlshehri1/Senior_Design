"""Local scanner acceptance gates; no real memory load, files sent or hosted access."""
import importlib.util
from pathlib import Path

import pytest

spec=importlib.util.spec_from_file_location('verify_local_scanner',Path(__file__).parents[1]/'scripts/verify_local_scanner.py')
scanner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


@pytest.fixture
def files(tmp_path):
    executable=tmp_path/'clamscan.exe';executable.write_bytes(b'synthetic engine')
    database=tmp_path/'database';database.mkdir()
    for name in ('main','daily','bytecode'):(database/(name+'.cvd')).write_bytes(b'synthetic database')
    return executable,database


def test_low_memory_stops_before_engine_or_test_file_creation(files,monkeypatch):
    monkeypatch.setattr(scanner,'available_memory',lambda:1024**3)
    monkeypatch.setattr(scanner.subprocess,'run',lambda *a,**k:pytest.fail('Do not load signature engine under low memory'))
    result=scanner.verify(*files)
    assert result['status']=='BLOCKED_INSUFFICIENT_FREE_RAM' and result['tests']==[]


def test_missing_database_cannot_pass(files,monkeypatch):
    (files[1]/'daily.cvd').unlink()
    with pytest.raises(RuntimeError,match='OFFICIAL_DATABASE_SET_REQUIRED'):scanner.verify(*files)


def test_real_acceptance_requires_both_clean_and_detection_exits(files,monkeypatch):
    monkeypatch.setattr(scanner,'available_memory',lambda:4*1024**3)
    results=iter([0,1]);seen=[]
    def run(args,**kwargs):
        seen.append(args)
        assert '--official-db-only=yes' in args and '--fail-if-cvd-older-than=7' in args
        assert kwargs['timeout']==120
        return type('Result',(),{'returncode':next(results)})()
    monkeypatch.setattr(scanner.subprocess,'run',run)
    assert scanner.verify(*files)['status']=='PASS_REAL_OFFICIAL_DATABASE_SCANS'
    assert len(seen)==2


def test_stale_or_broken_database_never_produces_acceptance(files,monkeypatch):
    monkeypatch.setattr(scanner,'available_memory',lambda:4*1024**3)
    monkeypatch.setattr(scanner.subprocess,'run',lambda *a,**k:type('Result',(),{'returncode':2})())
    assert scanner.verify(*files)['status']=='FAILED_REAL_SCAN'
