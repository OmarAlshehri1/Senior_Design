"""Build the complete source-bound compact Payments result package offline."""
import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sqlite3

import joblib
import numpy as np

from app.services.audit_rules import evaluate_transaction_rules, calculate_rule_score
from app.services.payments_primary_model import FEATURES, MODEL_VERSION, validate_bundle
from app.services.risk_scoring import calculate_risk_score

ARTIFACT_SHA = '7a5163cb0a87fac5096889a7d4677917f955ca4dce692bb9d82d48336e931859'
CSV_SHAS = {'fit': 'd33dd66ed1f62fd59af87d5c586012cd576aac24bb92db95a0a20b0c1d810399',
            'validation': '7d245b7cdd71b101f62fe77b883a8a8ff22d5d781f2a8705ad45139f8db62d8f'}


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def bound_matrix(path, db, baseline, expected_hash):
    assert digest(path) == expected_hash, 'MODEL_INPUT_CSV_CHANGED'
    vectors = []
    with path.open(encoding='utf-8-sig', newline='') as handle:
        for original in csv.DictReader(handle):
            source_row = int(original['record_id'].rsplit('-', 1)[1])
            saved = db.execute('select source from payments where source_row=?', (source_row,)).fetchone()
            assert saved is not None, 'MODEL_RECORD_NOT_IN_SELECTED_DATASET'
            selected = json.loads(saved[0])
            assert selected['VENDOR NAME'] == original['VENDOR NAME'], 'MODEL_SOURCE_NAME_CHANGED'
            assert selected['CHECK DATE'] == original['CHECK DATE'], 'MODEL_SOURCE_DAY_CHANGED'
            assert Decimal(selected['AMOUNT']).quantize(Decimal('.01')) == Decimal(original['AMOUNT']).quantize(Decimal('.01')), 'MODEL_SOURCE_AMOUNT_CHANGED'
            original_features = baseline.transform(original)
            selected_features = baseline.transform(selected)
            vector = np.array([selected_features[n] for n in FEATURES], dtype=np.float32)
            assert np.array_equal(vector, np.array([original_features[n] for n in FEATURES], dtype=np.float32)), 'MODEL_INPUT_FEATURES_CHANGED'
            vectors.append(vector)
    assert digest(path) == expected_hash
    return np.asarray(vectors, dtype=np.float32)


def stripped_template(rule):
    rule = json.loads(json.dumps(rule))
    evidence = rule['evidence']
    if rule['rule_key'] == 'approval_limits' and rule['status'] == 'FAILED':
        evidence.pop('excess_amount')
    if rule['rule_key'] == 'duplicate_payment':
        evidence.pop('matching_transaction_count')
    if rule['rule_key'] == 'invoice_splitting':
        evidence.pop('historical_transaction_count')
        evidence.pop('window_total_amount')
    return rule


def build(prepared, private, output):
    assert not output.exists(), 'FRESH_OUTPUT_REQUIRED'
    source_manifest = json.loads((prepared / 'manifest.json').read_text())
    assert source_manifest['status'] == 'PREPARED_OFFLINE' and source_manifest['counts']['accepted'] == 355426
    dataset = source_manifest['dataset_id']
    output.mkdir()
    source = sqlite3.connect(f'file:{(prepared / "prepared.sqlite").resolve().as_posix()}?mode=ro', uri=True)
    artifact = private / 'payments-calendar-ablation-20261025/without_calendar.joblib'
    assert digest(artifact) == ARTIFACT_SHA, 'RESEARCH_ARTIFACT_CHANGED'
    research = joblib.load(artifact)
    assert tuple(research['feature_names']) == FEATURES
    baseline = research['baseline']
    print('Validating all Fit and Validation feature inputs against the selected workbook...', flush=True)
    fit = bound_matrix(private / 'payments-fit-validation-20261024/fit.csv', source, baseline, CSV_SHAS['fit'])
    validation = bound_matrix(private / 'payments-fit-validation-20261024/validation.csv', source, baseline, CSV_SHAS['validation'])
    assert len(fit) == 199092 and len(validation) == 49614
    fit_reference = np.sort(-research['estimator'].score_samples(fit))
    validation_severity = -research['estimator'].score_samples(validation)
    assert np.isfinite(fit_reference).all() and np.isfinite(validation_severity).all()
    assert int((validation_severity >= research['threshold']).sum()) == 496, 'FROZEN_VALIDATION_WORKLOAD_CHANGED'
    threshold = round(float(np.searchsorted(fit_reference, research['threshold'], side='left') / len(fit_reference) * 100), 2)
    validation_ranks = np.round(100 * np.searchsorted(fit_reference, validation_severity, side='right') / len(fit_reference), 2)
    # Quantized ranks can tie. Preserve the Validation-only review budget after
    # translating the frozen raw cutoff into the application's two-decimal scale.
    while int((validation_ranks >= threshold).sum()) > 496:
        threshold = round(threshold + .01, 2)
    assert threshold <= 100
    bundle = {'schema': 'payments-primary-runtime-v1', 'dataset_key': dataset,
              'model_version': MODEL_VERSION, 'feature_names': FEATURES,
              'baseline': baseline, 'estimator': research['estimator'],
              'fit_reference_severities': fit_reference, 'raw_threshold': research['threshold'],
              'percentile_threshold': threshold, 'fit_count': len(fit), 'validation_count': len(validation),
              'research_artifact_sha256': ARTIFACT_SHA, 'selected_workbook_sha256': source_manifest['source_sha256'],
              'operational_scope': 'Owner-authorized simulation-enriched Payments dataset',
              'fraud_accuracy': None, 'independent_holdout_claim': False}
    model = validate_bundle(bundle, dataset)
    model_path = output / 'payments-primary-model.joblib'
    joblib.dump(bundle, model_path, compress=3)
    assert model_path.stat().st_size < 10 * 1024 * 1024
    restored = validate_bundle(joblib.load(model_path), dataset)
    probe_rows = [json.loads(r[0]) for r in source.execute('select source from payments limit 20')]
    assert model.score_source_rows(probe_rows)[1] == restored.score_source_rows(probe_rows)[1]
    raw, together = model.score_source_rows(probe_rows)
    separate = [model.score_source_rows([row])[1][0] for row in probe_rows]
    assert together == separate and np.isfinite(raw).all()
    # Synthetic authority/clock changes must have no effect on the source-only model.
    modified = [{**r, 'CHECK DATE': '01/01/2000', 'CREATED_BY': 'OTHER', 'APPROVED_BY': 'OTHER', 'APPROVAL_LIMIT': '1',
                 'TRANSACTION_TIME': '0', 'VENDOR_ID': 'OTHER'} for r in probe_rows]
    assert together == model.score_source_rows(modified)[1]
    print('Payments model binding, serialization, batching and feature isolation passed.', flush=True)

    db = sqlite3.connect(output / 'results.sqlite')
    db.execute('attach database ? as src', (str((prepared / 'prepared.sqlite').resolve()),))
    db.execute('create table results(id text primary key, duplicate_count integer, window_count integer, window_total_cents integer, rule_mask integer, rule_scaled integer, ai_scaled integer, risk_scaled integer, raw_severity real)')
    db.execute('insert into results(id,duplicate_count,window_count,window_total_cents) select id,count(*) over(partition by vendor_id,invoice,amount_cents)-1,0,amount_cents from src.payments')
    for limit in (1000000, 2500000, 5000000):
        db.execute('create table window_stage as select id,limit_cents,count(*) over w-1 as n,sum(amount_cents) over w as total from src.payments where amount_cents<=? window w as (partition by vendor_id order by epoch range between 86400 preceding and current row)', (limit,))
        db.execute('create unique index window_stage_id on window_stage(id)')
        db.execute('update results set window_count=(select n from window_stage w where w.id=results.id),window_total_cents=(select total from window_stage w where w.id=results.id) where id in (select id from window_stage where limit_cents=?)', (limit,))
        db.execute('drop table window_stage')
        db.commit()
        print(f'Complete source history prepared for approval limit {limit // 100}.', flush=True)
    references = json.loads((prepared / 'references.json').read_text())
    templates = {}
    checks = []
    distributions = Counter()
    last = 0
    count = 0
    while True:
        records = db.execute('select p.rowid,p.id,p.source,p.payload,r.duplicate_count,r.window_count,r.window_total_cents from src.payments p join results r on r.id=p.id where p.rowid>? order by p.rowid limit 5000', (last,)).fetchall()
        if not records:
            break
        raw, scores = model.score_source_rows([json.loads(r[2]) for r in records])
        assert scores == model.score_transactions([json.loads(r[3]) for r in records]), 'CANONICAL_MODEL_FEATURE_PARITY_FAILED'
        updates = []
        for row, severity, score in zip(records, raw, scores, strict=True):
            last, identifier, original, payload, duplicate, window_count, window_total = row
            original = json.loads(original)
            transaction = json.loads(payload)
            transaction['amount'] = Decimal(transaction['amount']).quantize(Decimal('.01'))
            transaction['approval_limit'] = Decimal(transaction['approval_limit']).quantize(Decimal('.01'))
            vendor = references['vendors'][transaction['vendor_id']]
            assert vendor['SOURCE_VENDOR_NAME'] == original['VENDOR NAME'] and vendor['STATUS'] == 'ACTIVE'
            rules = evaluate_transaction_rules(transaction, context={
                'duplicate_payment_count': duplicate,
                'invoice_splitting_context': {'historical_transaction_count': window_count,
                    'window_total_amount': (Decimal(window_total) / 100).quantize(Decimal('.01'))},
                'ghost_vendor_context': {'registry_authoritative': True, 'vendor_registered': True, 'vendor_active': True}})
            assert all(r['status'] in ('PASSED', 'FAILED') for r in rules)
            rule_score = calculate_rule_score(rules)
            mask = sum((r['status'] == 'FAILED') << i for i, r in enumerate(rules))
            assert rule_score == mask.bit_count() * 20
            risk = calculate_risk_score(rule_score, score)
            assert 0 <= score <= 100 and 0 <= risk <= 100 and np.isfinite(severity)
            distributions['high' if risk >= 75 else 'medium' if risk >= 50 else 'low'] += 1
            distributions['anomaly_candidates'] += score >= threshold
            distributions[f'rule_mask_{mask}'] += 1
            for ordinal, rule in enumerate(rules):
                key = f'{ordinal}:{rule["status"]}'
                template = stripped_template(rule)
                assert key not in templates or templates[key] == template, 'UNEXPECTED_DYNAMIC_RULE_EVIDENCE'
                templates[key] = template
            if len(checks) < 50 or count % 177 == 0:
                checks.append({'id': identifier, 'rule_results': rules, 'ai_score': score,
                               'risk_score': risk, 'rule_score': rule_score})
            updates.append((mask, int(round(rule_score * 100)), int(round(score * 100)),
                            int(round(risk * 100)), float(severity), identifier))
            count += 1
        db.executemany('update results set rule_mask=?,rule_scaled=?,ai_scaled=?,risk_scaled=?,raw_severity=? where id=?', updates)
        db.commit()
        if count % 25000 == 0:
            print(json.dumps({'scored': count, 'risk_counts': dict(distributions)}), flush=True)
    assert count == 355426
    assert db.execute('select count(*) from results where risk_scaled is null').fetchone()[0] == 0
    db.execute('create index results_risk on results(risk_scaled)')
    db.commit()
    db.close()
    source.close()
    assert digest(artifact) == ARTIFACT_SHA
    (output / 'rule-templates.json').write_text(json.dumps(templates, indent=2), encoding='utf-8')
    (output / 'rule-parity-samples-private.json').write_text(json.dumps(checks), encoding='utf-8')
    manifest = {'status': 'ALL_PAYMENTS_SCORED_OFFLINE', 'dataset_key': dataset,
                'selected_workbook_sha256': source_manifest['source_sha256'],
                'model_version': MODEL_VERSION, 'artifact_sha256': digest(model_path),
                'artifact_bytes': model_path.stat().st_size, 'feature_names': list(FEATURES),
                'fit_count': len(fit), 'validation_count': len(validation),
                'fit_validation_inputs_match_selected_workbook': True,
                'frozen_validation_candidates': 496, 'percentile_threshold': threshold,
                'normalized_validation_candidates': int((validation_ranks >= threshold).sum()),
                'raw_threshold': research['threshold'], 'scored_count': count,
                'rule_parity_count': count, 'risk_counts': dict(distributions),
                'source_only_feature_isolation_passed': True, 'serialization_and_batch_parity_passed': True,
                'rule_template_count': len(templates), 'core_rule_evidence_sample_count': len(checks),
                'scored_at': datetime.now(timezone.utc).isoformat(),
                'training_or_threshold_selection_on_testing': False,
                'full_population_inference_includes_historically_exposed_testing': True,
                'fraud_accuracy': None, 'production_modified': False}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--private', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build(args.prepared, args.private, args.output)
