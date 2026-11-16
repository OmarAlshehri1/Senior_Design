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


def memory_reader(values):
    def read(path):
        if path not in values:raise FileNotFoundError(path)
        return values[path]
    return read


def test_linux_host_available_memory_without_container_limit():
    assert scanner.linux_available_memory(memory_reader({'/proc/meminfo':'MemAvailable: 4194304 kB\n',
        '/sys/fs/cgroup/memory.max':'max'}))==4*1024**3


def test_linux_container_limit_prevents_host_ram_false_readiness():
    values={'/proc/meminfo':'MemAvailable: 8388608 kB\n','/sys/fs/cgroup/memory.max':str(2*1024**3),
            '/sys/fs/cgroup/memory.current':str(512*1024**2)}
    assert scanner.linux_available_memory(memory_reader(values))==1536*1024**2


def test_linux_cgroup_v1_limit_is_respected():
    values={'/proc/meminfo':'MemAvailable: 4194304 kB\n',
            '/sys/fs/cgroup/memory/memory.limit_in_bytes':str(6*1024**3),
            '/sys/fs/cgroup/memory/memory.usage_in_bytes':str(4*1024**3)}
    assert scanner.linux_available_memory(memory_reader(values))==2*1024**3


def test_linux_unknown_memory_cannot_pass():
    with pytest.raises(RuntimeError,match='MEMORY_CHECK_FAILED'):
        scanner.linux_available_memory(memory_reader({'/proc/meminfo':'MemFree: 123 kB\n'}))


def test_linux_invalid_container_accounting_cannot_pass():
    with pytest.raises(RuntimeError,match='CGROUP_MEMORY_CHECK_FAILED'):
        scanner.linux_available_memory(memory_reader({'/proc/meminfo':'MemAvailable: 4194304 kB\n',
            '/sys/fs/cgroup/memory.max':'not-a-limit'}))
