"""Explicit loopback-only browser fixture. Never used by app.main or deployment."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from threading import Lock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main(port=0):
    for key in ('TRANSACTION_RECOVERY_ENABLED', 'CASE_SLA_ESCALATION_ENABLED', 'DAILY_REPORT_SCHEDULER_ENABLED'):
        os.environ[key] = 'false'
    for key in ('COMPANY_IMPORTS_ENABLED', 'FEED_REVIEW_ENABLED', 'INGESTION_ENABLED', 'INGESTION_VALIDATION_ENABLED', 'INGESTION_AUDIT_ENABLED', 'INGESTION_FEED_ANOMALY_ENABLED'):
        os.environ[key] = 'true'
    os.environ['SUPABASE_URL'] = 'http://127.0.0.1:1'
    os.environ['SUPABASE_SECRET_KEY'] = 'not-a-hosted-credential'
    os.environ['FRONTEND_ORIGINS'] = 'http://127.0.0.1:5189'
    env = {**os.environ, 'IMPORT_FIXTURE_MODEL_HASH': hashlib.sha256((BACKEND/'models/isolation_forest_v1.joblib').read_bytes()).hexdigest()}
    process = subprocess.Popen(['node', str(BACKEND/'test-support/company-import-bridge.mjs')],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8', env=env)
    ready = json.loads(process.stdout.readline())
    lock = Lock()
    from app.main import app
    from app.repositories import identity, ingestion
    from app.services.identity import get_current_user
    def rpc(name, payload=None, **kwargs):
        with lock:
            process.stdin.write(json.dumps({'name': name, 'payload': payload if payload is not None else kwargs})+'\n')
            process.stdin.flush()
            result = json.loads(process.stdout.readline())
        if 'error' in result:
            raise identity.IdentityError(result['error'], {'42501': 403, 'P0002': 404, '23505': 409, '22023': 422}.get(result.get('code'), 503))
        return result['result']
    identity.rpc = rpc
    ingestion.rpc = rpc
    app.dependency_overrides[get_current_user] = lambda: {'id': ready['admin'], 'role': 'ADMIN'}
    import uvicorn
    listener = socket.socket()
    listener.bind(('127.0.0.1', port))
    print(json.dumps({'port': listener.getsockname()[1], 'identity': 'synthetic Admin fixture', 'database': 'in-memory PGlite'}), flush=True)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level='warning', access_log=False)).run(sockets=[listener])
    finally:
        process.stdin.close()
        process.wait(timeout=15)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    if args.port != 0 and not 1024 <= args.port <= 65535:
        parser.error('Choose an unprivileged local port.')
    main(args.port)
