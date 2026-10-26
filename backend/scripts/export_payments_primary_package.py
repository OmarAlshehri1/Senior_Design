"""Export private bounded import records from fully validated offline results."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3


def export(prepared, results, output):
    prepared, results, output = map(Path, (prepared, results, output))
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((prepared / 'manifest.json').read_text())
    connection = sqlite3.connect(prepared / 'prepared.sqlite')
    connection.execute('attach database ? as scored', (str(results / 'results.sqlite'),))
    connection.row_factory = sqlite3.Row
    count = 0
    with (output / 'payments-private.jsonl').open('w', encoding='utf8', newline='\n') as handle:
        for row in connection.execute('select p.*,r.* from payments p join scored.results r using(id) order by p.source_row'):
            value = json.loads(row['payload'])
            provenance = value.pop('metadata')
            value['transaction_timestamp'] = value.pop('timestamp')
            value['completeness_status'] = value.pop('data_quality_status')
            value['source_row'] = row['source_row']
            value['contract_reference'] = provenance.get('contract_reference')
            value['metadata'] = {}
            for key in ('source_amount_text', 'original_vendor_name'):
                original = provenance.get(key)
                canonical = value['amount'] if key == 'source_amount_text' else value['vendor_name']
                if original is not None and original != canonical:
                    value['metadata'][key] = original
            value.update(primary_rule_mask=row['rule_mask'], primary_duplicate_count=row['duplicate_count'],
                         primary_window_count=row['window_count'],
                         primary_window_total=f"{row['window_total_cents']/100:.2f}",
                         primary_ai_scaled=row['ai_scaled'], primary_rule_scaled=row['rule_scaled'],
                         primary_risk_scaled=row['risk_scaled'], primary_raw_severity=row['raw_severity'])
            handle.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
            count += 1
    assert count == 355426, 'Entire selected population required'
    references = json.loads((prepared / 'references.json').read_text())
    with (output / 'vendors-private.jsonl').open('w', encoding='utf8', newline='\n') as handle:
        for vendor in references['vendors'].values():
            value = {'vendor_id': vendor['VENDOR_ID'], 'vendor_name': vendor['SOURCE_VENDOR_NAME'],
                     'is_active': vendor['STATUS'] == 'ACTIVE',
                     'source_reference': references['dataset_id']}
            handle.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    receipt = {'rows': count, 'vendors': len(references['vendors']), 'production_modified': False,
               'files': {}}
    for file in sorted(output.glob('*-private.jsonl')):
        with file.open('rb') as handle:
            receipt['files'][file.name] = {'sha256': hashlib.file_digest(handle, 'sha256').hexdigest(),
                                         'bytes': file.stat().st_size}
    (output / 'package-manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', required=True)
    parser.add_argument('--results', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(export(args.prepared, args.results, args.output)))
