"""Bounded real ClamAV acceptance on existing Windows hardware; no hosted access.

Requires current official main/daily/bytecode databases and 3 GiB free RAM.
Writes no EICAR test file unless that resource gate passes. Never claims a stub
or a reduced/custom signature database establishes malware scanning readiness.
"""
import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def available_memory():
    class Memory(ctypes.Structure):
        _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(name,ctypes.c_ulonglong) for name in
            ('total','available','page_total','page_available','virtual_total','virtual_available','extended')]
    value=Memory();value.length=ctypes.sizeof(value)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
        raise RuntimeError('MEMORY_CHECK_FAILED')
    return value.available


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(executable,database):
    report={'utc':datetime.now(timezone.utc).isoformat(),'status':'NOT_VERIFIED','hosted_access':False,
            'engine_sha256':sha(executable),'database':{},'tests':[]}
    for name in ('main','daily','bytecode'):
        choices=[p for ext in ('cvd','cld') if (p:=database/(name+'.'+ext)).is_file()]
        if len(choices)!=1:raise RuntimeError('OFFICIAL_DATABASE_SET_REQUIRED')
        path=choices[0];report['database'][path.name]=sha(path)
    report['available_ram_bytes']=available_memory()
    if report['available_ram_bytes']<3*1024**3:
        report['status']='BLOCKED_INSUFFICIENT_FREE_RAM'
        return report
    # Standard harmless EICAR antivirus test string, assembled only after RAM gate.
    eicar=b'X5O!P%@AP[4\\PZX54(P^)7CC)7}'+b'$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    with tempfile.TemporaryDirectory(prefix='m004-scanner-acceptance-') as folder:
        for name,content,expected in [('clean.pdf',b'%PDF-1.7\nSynthetic clean test\n%%EOF',0),
                                      ('eicar.com',eicar,1)]:
            path=Path(folder)/name;path.write_bytes(content)
            result=subprocess.run([str(executable),'--no-summary','--database='+str(database),
                '--official-db-only=yes','--fail-if-cvd-older-than=7','--alert-exceeds-max=yes',
                '--alert-encrypted=yes',str(path)],capture_output=True,timeout=120,check=False)
            report['tests'].append({'fixture':name,'exit_code':result.returncode,'expected':expected})
            if result.returncode!=expected:
                report['status']='FAILED_REAL_SCAN';return report
    report['status']='PASS_REAL_OFFICIAL_DATABASE_SCANS'
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable',required=True,type=Path)
    parser.add_argument('--database',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    try:report=verify(args.executable.resolve(),args.database.resolve())
    except Exception as error:report={'status':'NOT_VERIFIED','error_type':type(error).__name__,'hosted_access':False}
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
    raise SystemExit(0 if report['status']=='PASS_REAL_OFFICIAL_DATABASE_SCANS' else 2)
