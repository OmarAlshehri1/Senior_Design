"""Staging-only, source-scoped pilot review storage. Never changes feed risk/results."""
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import HTTPException

STAGING_HOST = 'gunvsnvxipetxavpajjv.supabase.co'
PRIVATE = Path(__file__).resolve().parents[2]/'.feed-simulator'


def storage_configuration():
    """Explicit selector; a server failure never falls back to SQLite."""
    if (os.getenv('PAYMENTS_MODEL_REVIEW_ENABLED', 'true').lower() != 'true'
            or urlsplit(os.getenv('SUPABASE_URL', '')).hostname != STAGING_HOST):
        raise HTTPException(404, 'MODEL_REVIEW_DISABLED')
    mode = os.getenv('PAYMENTS_MODEL_REVIEW_STORAGE', 'sqlite')
    if mode == 'sqlite':
        return mode, None
    dataset = os.getenv('PAYMENTS_MODEL_REVIEW_DATASET', '')
    if mode != 'supabase' or not re.fullmatch('[0-9a-f]{64}', dataset):
        raise HTTPException(503, 'MODEL_REVIEW_CONFIGURATION_INVALID')
    return mode, dataset


def package():
    configured = os.getenv('PAYMENTS_MODEL_REVIEW_PACKAGE', '')
    if not configured or urlsplit(os.getenv('SUPABASE_URL', '')).hostname != STAGING_HOST:
        raise HTTPException(404, 'MODEL_REVIEW_DISABLED')
    directory = Path(configured).resolve()
    if not directory.is_relative_to(PRIVATE.resolve()):
        raise HTTPException(503, 'MODEL_REVIEW_PACKAGE_INVALID')
    try:
        raw = (directory/'web_package.json').read_bytes()
        manifest = json.loads((directory/'web_manifest.json').read_text(encoding='utf-8'))
        if hashlib.sha256(raw).hexdigest() != manifest['web_package_sha256']:
            raise ValueError()
        data = json.loads(raw)
        if (data['source_id'] != 'payments-file-local' or len(data['items']) != 60
                or data['combined_risk'] is not None):
            raise ValueError()
        return directory, data
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(503, 'MODEL_REVIEW_PACKAGE_INVALID') from None


def connect(directory):
    db = sqlite3.connect(directory/'pilot_reviews.sqlite', timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('''create table if not exists reviews (
        dataset text, case_id text, actor text, outcome text, note text, version integer, updated_at text,
        primary key(dataset,case_id,actor))''')
    db.execute('''create table if not exists review_events (
        dataset text, case_id text, actor text, outcome text, note text, version integer, updated_at text)''')
    db.execute('''create table if not exists review_write_freezes (
        dataset text primary key, frozen_at text not null)''')
    db.commit()
    return db


def list_reviews(directory, data, actor):
    db = connect(directory)
    try:
        saved = {r['case_id']: dict(r) for r in db.execute(
            'select case_id,outcome,note,version,updated_at from reviews where dataset=? and actor=?',
            (data['dataset_id'], actor))}
    finally:
        db.close()
    return {**data, 'items': [{**item, 'review': saved.get(item['case_id'], {'version': 0})} for item in data['items']]}


def save_review(directory, data, actor, case_id, outcome, note, expected_version):
    if not any(item['case_id'] == case_id for item in data['items']):
        raise HTTPException(404, 'NOT_FOUND')
    db = connect(directory)
    try:
        db.execute('begin immediate')
        if db.execute('select 1 from review_write_freezes where dataset=?', (data['dataset_id'],)).fetchone():
            raise HTTPException(503, 'MODEL_REVIEW_WRITES_FROZEN')
        row = db.execute('select version from reviews where dataset=? and case_id=? and actor=?',
                         (data['dataset_id'], case_id, actor)).fetchone()
        if (row['version'] if row else 0) != expected_version:
            raise HTTPException(409, 'REVIEW_VERSION_CONFLICT')
        version = expected_version+1
        updated = datetime.now(timezone.utc).isoformat()
        values = (data['dataset_id'], case_id, actor, outcome, note, version, updated)
        db.execute('insert or replace into reviews values (?,?,?,?,?,?,?)', values)
        db.execute('insert into review_events values (?,?,?,?,?,?,?)', values)
        db.commit()
        return {'case_id': case_id, 'outcome': outcome, 'note': note, 'version': version, 'updated_at': updated}
    finally:
        db.close()


def freeze_writes(directory, data):
    """Durable one-way boundary, serialized with all supported SQLite writers."""
    db = connect(directory)
    try:
        db.execute('begin immediate')
        db.execute('insert or ignore into review_write_freezes values (?,?)',
                   (data['dataset_id'], datetime.now(timezone.utc).isoformat()))
        db.commit()
    finally:
        db.close()
