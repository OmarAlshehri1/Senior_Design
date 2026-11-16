"""Free existing-machine scanner. No service-role key or human login is required.

Default plan only. Execution needs a private explicitly approved configuration.
Lost POST responses are not retried; finite server leases safely recover work.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.case_evidence import EvidenceError, MAX_EVIDENCE_BYTES, scan_clean_file, validate_filename
from verify_local_scanner import available_memory, verify


class ScannerBlocked(RuntimeError):
    pass


class Worker:
    def __init__(self, client, config, token, ready=verify, memory=available_memory):
        origin = urlsplit(config['api_url'])
        if origin.scheme != 'https' or origin.username or origin.password or origin.query or origin.fragment:
            raise ScannerBlocked('INVALID_API_ORIGIN')
        self.client, self.config, self.token = client, config, token
        self.ready, self.memory = ready, memory
        self.proof = None
        self.signature = None
        self.verified_at = 0.0

    def scanner_ready(self):
        if self.memory() < 3 * 1024 ** 3:
            raise ScannerBlocked('SCANNER_FREE_RAM_REQUIRED')
        engine, database = Path(self.config['executable']), Path(self.config['database'])
        files = [engine] + sorted(list(database.glob('*.cvd')) + list(database.glob('*.cld')))
        signature = tuple((str(path), path.stat().st_size, path.stat().st_mtime_ns) for path in files)
        if signature != self.signature or time.monotonic() - self.verified_at >= 3600:
            proof = self.ready(engine, database)
            if proof['status'] != 'PASS_REAL_OFFICIAL_DATABASE_SCANS':
                raise ScannerBlocked('REAL_OFFICIAL_DATABASE_SCANS_REQUIRED')
            self.proof, self.signature = proof, signature
            self.verified_at = time.monotonic()

    def request(self, method, path, **kwargs):
        response = self.client.request(method, self.config['api_url'].rstrip('/') + '/api/v1/internal/evidence-scans' + path,
                                       headers={'Authorization': 'Bearer ' + self.token}, **kwargs)
        if response.status_code != 200:
            raise ScannerBlocked('SCANNER_API_REQUEST_FAILED_NO_IMMEDIATE_RETRY')
        return response

    def check_binding(self):
        status = self.request('GET', '/status').json()
        if status.get('project_ref') != self.config['project_ref'] or status.get('bucket_private') is not True:
            raise ScannerBlocked('EXACT_PROJECT_AND_PRIVATE_BUCKET_REQUIRED')

    def one(self):
        self.scanner_ready()  # No remote claim or object download before real readiness.
        self.check_binding()
        metadata = self.request('POST', '/claim').json()
        if metadata is None:
            return {'status': 'IDLE'}
        if not 0 < metadata['file_size'] <= MAX_EVIDENCE_BYTES:
            raise ScannerBlocked('INVALID_OBJECT_SIZE')
        expiry = datetime.fromisoformat(metadata['lease_until'].replace('Z', '+00:00'))
        if (expiry - datetime.now(timezone.utc)).total_seconds() < 45:
            raise ScannerBlocked('INSUFFICIENT_SCAN_LEASE')
        state = 'ERROR'
        try:
            deadline = time.monotonic() + 30
            data = bytearray()
            headers = {'Authorization': 'Bearer ' + self.token, 'X-Scan-Lease': metadata['lease_token']}
            with self.client.stream('GET', self.config['api_url'].rstrip('/') +
                                    '/api/v1/internal/evidence-scans/' + metadata['id'] + '/content', headers=headers) as response:
                if response.status_code != 200:
                    raise ScannerBlocked('QUARANTINE_CONTENT_UNAVAILABLE')
                for block in response.iter_bytes():
                    if len(data) + len(block) > MAX_EVIDENCE_BYTES or time.monotonic() > deadline:
                        raise ScannerBlocked('OBJECT_SIZE_LIMIT')
                    data.extend(block)
            if len(data) != metadata['file_size'] or hashlib.sha256(data).hexdigest() != metadata['content_sha256']:
                raise ScannerBlocked('CONTENT_DIGEST_OR_SIZE_CHANGED')
            _, extension = validate_filename(metadata['file_name'], metadata['mime_type'], bytes(data))
            os.environ['CASE_ANTIVIRUS_EXECUTABLE'] = self.config['executable']
            os.environ['CASE_ANTIVIRUS_DATABASE'] = self.config['database']
            scan_clean_file(bytes(data), extension)
            state = 'CLEAN'
        except EvidenceError as error:
            state = 'INFECTED' if error.code == 'EVIDENCE_REJECTED_BY_SCANNER' else 'ERROR'
        except (ScannerBlocked, httpx.HTTPError):
            state = 'ERROR'
        # Never replay a finish after an ambiguous response. The server binds it
        # to this lease/digest and finite expiry recovers an unacknowledged job.
        result = self.request('POST', '/' + metadata['id'] + '/finish', json={
            'lease_token': metadata['lease_token'], 'content_sha256': metadata['content_sha256'],
            'scan_status': state, 'proof': {'engine_sha256': self.proof['engine_sha256'],
                                          'database': self.proof['database']}}).json()
        return {'status': result['scan_status'], 'automatic_retry': False}


def main(args):
    if not args.execute:
        print('PLAN ONLY: automatic external ClamAV scanning with a scoped token, real readiness gate, private storage, finite leases and no paid service.')
        return
    config_path = Path(args.config)
    config = json.loads(config_path.read_text())
    if config.get('execution_approved') is not True or config.get('worker_protocol') != 1:
        raise ScannerBlocked('EXPLICIT_STEADY_STATE_EXECUTION_APPROVAL_REQUIRED')
    token = Path(config['token_file']).read_text().strip()
    if not 32 <= len(token) <= 512 or any(c.isspace() for c in token):
        raise ScannerBlocked('PRIVATE_SCOPED_TOKEN_REQUIRED')
    with httpx.Client(transport=httpx.HTTPTransport(retries=0), timeout=httpx.Timeout(15, connect=5),
                      follow_redirects=False, trust_env=False) as client:
        worker = Worker(client, config, token)
        while True:
            try:
                print(json.dumps(worker.one()), flush=True)
            except Exception as error:
                # No tokens, response bodies, filenames, contents or raw exceptions.
                print(json.dumps({'status': 'QUARANTINE_RETAINED', 'error_type': type(error).__name__}), flush=True)
                if not args.run_forever:
                    raise SystemExit(1) from None
                time.sleep(60)
                continue
            if not args.run_forever:
                break
            time.sleep(15)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--config')
    parser.add_argument('--run-forever', action='store_true')
    try:
        main(parser.parse_args())
    except ScannerBlocked as error:
        raise SystemExit('STOP: ' + str(error) + '; keep files quarantined.') from None
