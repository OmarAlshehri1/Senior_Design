"""Hosted Staging entry point. Environment only; no private package or local dotenv."""
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

STAGING_HOST = 'gunvsnvxipetxavpajjv.supabase.co'
DATASET = 'f64553fac65cc640dbdb7eb043f15f56893e0e159e47da15e67e9df8a2a1f324'
PRODUCTION_HOSTS = {'senior-design-gold.vercel.app', 'senior-design-1ypl.onrender.com'}
DISABLED = ('INGESTION_ENABLED', 'INGESTION_VALIDATION_ENABLED', 'INGESTION_AUDIT_ENABLED',
            'INGESTION_FEED_ANOMALY_ENABLED', 'TRANSACTION_RECOVERY_ENABLED',
            'DAILY_REPORT_SCHEDULER_ENABLED', 'CASE_SLA_ESCALATION_ENABLED', 'REPORT_GEMINI_ENABLED')


def hosted_environment(parent):
    env = dict(parent)
    if env.get('PAYMENTS_DEPLOYMENT_ENV') != 'staging':
        raise ValueError('EXPLICIT_STAGING_ENVIRONMENT_REQUIRED')
    if env.get('SUPABASE_URL', '').rstrip('/') != 'https://'+STAGING_HOST:
        raise ValueError('HOSTED_STAGING_DATABASE_MISMATCH')
    key = env.get('SUPABASE_SECRET_KEY', '')
    if len(key) < 30 or any(c.isspace() for c in key) or not key.startswith(('sb_secret_', 'eyJ')):
        raise ValueError('HOSTED_STAGING_BACKEND_SECRET_REQUIRED')
    if (env.get('PAYMENTS_MODEL_REVIEW_STORAGE') != 'supabase'
            or env.get('PAYMENTS_MODEL_REVIEW_DATASET') != DATASET):
        raise ValueError('RECONCILED_SERVER_DATASET_REQUIRED')
    if env.get('PAYMENTS_MODEL_REVIEW_ENABLED') not in ('true', 'false'):
        raise ValueError('EXPLICIT_MODEL_REVIEW_FLAG_REQUIRED')
    origins = env.get('FRONTEND_ORIGINS', '').split(',')
    for origin in origins:
        target = urlsplit(origin)
        if (target.scheme != 'https' or not target.hostname or target.netloc != target.hostname
                or target.path or target.query or target.fragment or target.username or target.password
                or target.hostname in PRODUCTION_HOSTS or '*' in origin
                or target.hostname in ('localhost', '127.0.0.1') or '.' not in target.hostname):
            raise ValueError('EXACT_HOSTED_STAGING_FRONTEND_ORIGINS_REQUIRED')
    redirect = urlsplit(env.get('SUPABASE_AUTH_REDIRECT_URL', ''))
    if (redirect.scheme+'://'+redirect.netloc not in origins or redirect.path != '/auth/callback'
            or redirect.query or redirect.fragment):
        raise ValueError('HOSTED_STAGING_AUTH_REDIRECT_MISMATCH')
    port = env.get('PORT', '')
    if not re.fullmatch('[0-9]{1,5}', port) or not 1024 <= int(port) <= 65535:
        raise ValueError('VALID_PROVIDER_PORT_REQUIRED')
    env.update({name: 'false' for name in DISABLED})
    env.update(PYTHON_DOTENV_DISABLED='1', PYTHONUTF8='1', GEMINI_API_KEY='',
               PAYMENTS_MODEL_REVIEW_PACKAGE='', WEB_CONCURRENCY='1')
    return env


def main():
    try:
        env = hosted_environment(os.environ)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps({'mode': 'PAYMENTS_HOSTED_STAGING', 'storage': 'supabase',
                      'workers_enabled': False, 'dotenv_fallback_enabled': False,
                      'model_review_enabled': env['PAYMENTS_MODEL_REVIEW_ENABLED'] == 'true'}), flush=True)
    return subprocess.call([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0',
                            '--port', env['PORT'], '--workers', '1', '--no-access-log'], env=env)


if __name__ == '__main__':
    raise SystemExit(main())
