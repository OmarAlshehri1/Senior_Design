"""Validate and prepare the selected Payments workbook offline. Never writes a server."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sqlite3
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from pydantic import ValidationError
from app.schemas.transaction import TransactionCreate

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
HEADERS = ['VOUCHER NUMBER', 'AMOUNT', 'CHECK DATE', 'CONTRACT NUMBER', 'VENDOR NAME',
           'CURRENCY', 'INVOICE_NUMBER', 'TECHNICAL_VENDOR_ID', 'VENDOR_ID', 'CREATED_BY',
           'APPROVED_BY', 'APPROVAL_LIMIT', 'TRANSACTION_TIME', 'TRANSACTION_TIMEZONE',
           'VENDOR_REGISTRY_STATUS', 'SOURCE_ROW']
EXPECTED_HASH = '028b093f8031c5c3b4bbbc8d52fe45f6c475a6dbc9350581cb1823ae708796cc'
REFERENCE_HASH = '29f4f9be083a5ea736f0047a090b1063144eb780757fe75c7f121451aa274269'


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def shared_strings(archive):
    if 'xl/sharedStrings.xml' not in archive.namelist():
        return []
    root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
    return [''.join(t.text or '' for t in si.iter(NS + 't')) for si in root]


def payment_sheet(archive):
    book = ET.fromstring(archive.read('xl/workbook.xml'))
    rels = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    targets = {r.attrib['Id']: r.attrib['Target'] for r in rels}
    for sheet in book.find(NS + 'sheets'):
        if sheet.attrib['name'] == 'Payments - 355426 rows':
            target = targets[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            return target.lstrip('/') if target.startswith('/') else 'xl/' + target
    raise ValueError('PAYMENTS_SHEET_REQUIRED')


def rows(archive, sheet, strings=None):
    path = f'xl/worksheets/sheet{sheet}.xml' if isinstance(sheet, int) else sheet
    with archive.open(path) as handle:
        parent = None
        for event, node in ET.iterparse(handle, events=('start', 'end')):
            if event == 'start' and node.tag == NS + 'sheetData':
                parent = node
            if event != 'end' or node.tag != NS + 'row':
                continue
            values = {}
            for cell in node.findall(NS + 'c'):
                if cell.find(NS + 'f') is not None:
                    raise ValueError('FORMULA_NOT_SUPPORTED')
                column = cell.attrib['r'].rstrip('0123456789')
                if cell.attrib.get('t') == 'inlineStr':
                    value = ''.join(t.text or '' for t in cell.iter(NS + 't'))
                else:
                    value = cell.findtext(NS + 'v')
                    if cell.attrib.get('t') == 's':
                        value = strings[int(value)]
                values[column] = value
            yield int(node.attrib['r']), values
            parent.clear()


def cents(value):
    number = Decimal(value)
    rounded = number.quantize(Decimal('0.01'))
    if not number.is_finite() or number < 0 or abs(number - rounded) > Decimal('0.000001'):
        raise ValueError('AMOUNT_REQUIRES_PRECISION_REVIEW')
    if rounded >= Decimal('1000000000000'):
        raise ValueError('AMOUNT_EXCEEDS_PRODUCTION_NUMERIC_RANGE')
    return int(rounded * 100)


def adapt(record, dataset, users):
    source_row = int(record['SOURCE_ROW'])
    if source_row <= 1:
        raise ValueError('INVALID_SOURCE_ROW')
    for field in ('CREATED_BY', 'APPROVED_BY'):
        if record[field] not in users:
            raise ValueError('UNKNOWN_WORKBOOK_ACTOR')
    if record['TRANSACTION_TIMEZONE'] != 'UTC':
        raise ValueError('UNSUPPORTED_SIMULATION_TIMEZONE')
    clock = Decimal(record['TRANSACTION_TIME']) * 86400
    seconds = int(clock.to_integral_value())
    if not 0 <= seconds < 86400 or abs(clock - seconds) > Decimal('0.000001'):
        raise ValueError('SIMULATION_TIME_REQUIRES_REVIEW')
    day = datetime.strptime(record['CHECK DATE'], '%m/%d/%Y').replace(tzinfo=timezone.utc)
    amount = cents(record['AMOUNT'])
    limit = cents(record['APPROVAL_LIMIT'])
    identifier = 'PAY-' + hashlib.sha256(f'{dataset}:{source_row}'.encode()).hexdigest()[:32]
    payload = {'id': identifier, 'timestamp': (day + timedelta(seconds=seconds)).isoformat(),
               'vendor_id': record['VENDOR_ID'], 'vendor_name': record['VENDOR NAME'],
               'invoice_number': record['INVOICE_NUMBER'], 'amount': str(Decimal(amount) / 100),
               'currency': record['CURRENCY'], 'created_by': record['CREATED_BY'],
               'approved_by': record['APPROVED_BY'], 'approver_role': users[record['APPROVED_BY']]['ROLE'],
               'approval_limit': str(Decimal(limit) / 100), 'category': None}
    validated = TransactionCreate.model_validate(payload).model_dump(mode='json')
    missing = [k for k, v in validated.items() if v is None]
    validated.update(data_quality_status='PARTIAL' if missing else 'COMPLETE', missing_fields=missing,
                     metadata={'source_schema': 'PAYMENTS_SIMULATION_WORKBOOK', 'dataset_id': dataset,
                               'source_row': source_row, 'source_date': record['CHECK DATE'],
                               'source_amount_text': record['AMOUNT'],
                               'voucher_number': record['VOUCHER NUMBER'],
                               'contract_reference': record['CONTRACT NUMBER'],
                               'technical_vendor_id': record['TECHNICAL_VENDOR_ID'],
                               'simulation_fields': ['actors', 'approval_limit', 'vendor_registry', 'time'],
                               'invoice_number_origin': 'VOUCHER_MAPPING_USER_DECLARED'})
    if validated['vendor_name'] != record['VENDOR NAME']:
        validated['metadata']['original_vendor_name'] = record['VENDOR NAME']
    return validated, amount, limit


def prepare(workbook, output):
    private = Path(__file__).resolve().parents[1] / '.feed-simulator'
    assert output.resolve().is_relative_to(private.resolve()) and output.resolve() != private.resolve()
    assert not output.exists(), 'FRESH_OUTPUT_DIRECTORY_REQUIRED'
    before = digest(workbook)
    assert before == EXPECTED_HASH, 'SELECTED_WORKBOOK_CHANGED'
    output.mkdir(parents=True)
    dataset = 'payments-edited-' + before[:16]
    db = sqlite3.connect(output / 'prepared.sqlite')
    db.execute('create table payments(id text primary key, source_row integer unique, epoch integer, vendor_id text, invoice text, amount_cents integer, limit_cents integer, payload text, source text)')
    counts = Counter()
    errors = []
    amount_sum = 0
    fields = Counter()
    references = workbook.parent / 'Payments_355426_Completed_SIMULATED_2026-10-23.xlsx'
    assert digest(references) == REFERENCE_HASH, 'ORIGINAL_REFERENCE_WORKBOOK_CHANGED'
    with ZipFile(references) as archive:
        users, registry = {}, {}
        for sheet, target, key in ((4, users, 'USER_ID'), (5, registry, 'VENDOR_ID')):
            headers = None
            for n, data in rows(archive, sheet):
                if n == 1:
                    headers = list(data.values())
                    continue
                entry = dict(zip(headers, [data.get(chr(65 + i)) for i in range(len(headers))]))
                entry = {k: v.removeprefix('SIM-') if isinstance(v, str) and k in {'USER_ID', 'ASSIGNED_BY', 'SIMULATED_VENDOR_ID'} else v for k, v in entry.items()}
                if 'SIMULATED_VENDOR_ID' in entry:
                    entry['VENDOR_ID'] = entry.pop('SIMULATED_VENDOR_ID')
                assert entry[key] not in target, 'DUPLICATE_REFERENCE_ID'
                target[entry[key]] = entry
        (output / 'references.json').write_text(json.dumps({'dataset_id': dataset, 'origin': 'SIMULATED',
            'users_are_data_actors_not_auth_accounts': True, 'users': users, 'vendors': registry}), encoding='utf-8')
        print(json.dumps({'reference_users': len(users), 'reference_vendors': len(registry)}), flush=True)
    with ZipFile(workbook) as archive:
        strings = shared_strings(archive)
        for number, data in rows(archive, payment_sheet(archive), strings):
            if number == 1:
                continue
            if number == 2:
                assert list(data.values()) == HEADERS, 'WORKBOOK_HEADERS_CHANGED'
                continue
            counts['source_rows'] += 1
            record = dict(zip(HEADERS, [data.get(chr(65 + i)) for i in range(len(HEADERS))]))
            for k, value in record.items():
                fields[k] = max(fields[k], len(value or ''))
            try:
                if record['VENDOR_ID'] not in registry:
                    raise ValueError('VENDOR_NOT_IN_SELECTED_WORKBOOK_REGISTRY')
                payload, amount, limit = adapt(record, dataset, users)
                epoch = int(datetime.fromisoformat(payload['timestamp']).timestamp())
                db.execute('insert into payments values(?,?,?,?,?,?,?,?,?)',
                           (payload['id'], int(record['SOURCE_ROW']), epoch, payload['vendor_id'],
                            payload['invoice_number'], amount, limit,
                            json.dumps(payload, separators=(',', ':')), json.dumps(record, separators=(',', ':'))))
                amount_sum += amount
                counts['accepted'] += 1
                counts[payload['data_quality_status'].lower()] += 1
                counts['above_workbook_limit'] += amount > limit
            except (ValueError, KeyError, ValidationError) as exc:
                counts['rejected'] += 1
                if len(errors) < 100:
                    errors.append({'worksheet_row': number, 'type': type(exc).__name__,
                                   'fields': [e['loc'] for e in exc.errors()] if isinstance(exc, ValidationError) else str(exc)})
            if counts['source_rows'] % 25000 == 0:
                db.commit()
                print(json.dumps(dict(counts)), flush=True)
    db.commit()
    db.execute('create index payment_vendor_time on payments(vendor_id,epoch)')
    db.execute('create index payment_duplicate_key on payments(vendor_id,invoice,amount_cents)')
    duplicate_groups = db.execute('select count(*) from (select 1 from payments group by vendor_id,invoice,amount_cents having count(*)>1)').fetchone()[0]
    dates = db.execute('select min(epoch),max(epoch) from payments').fetchone()
    payload_bytes = db.execute('select sum(length(cast(payload as blob))),avg(length(cast(payload as blob))) from payments').fetchone()
    db.close()
    assert digest(workbook) == before, 'WORKBOOK_CHANGED_DURING_PREPARATION'
    manifest = {'status': 'PREPARED_OFFLINE' if counts['accepted'] == 355426 and not counts['rejected'] else 'MAPPING_REVIEW_REQUIRED',
                'dataset_id': dataset, 'source_sha256': before, 'source_unchanged': True,
                'counts': dict(counts), 'amount_total_usd': str(Decimal(amount_sum) / 100),
                'reference_users': len(users), 'reference_vendors': len(registry),
                'reference_workbook_sha256': REFERENCE_HASH,
                'duplicate_key_groups': duplicate_groups, 'max_field_lengths': dict(fields),
                'timestamp_range': [datetime.fromtimestamp(t, timezone.utc).isoformat() for t in dates],
                'timestamps_include_simulated_clock': True, 'category_not_fabricated': True,
                'canonical_payload_bytes': payload_bytes[0], 'mean_payload_bytes': payload_bytes[1],
                'errors': errors, 'production_modified': False, 'model_inference_run': False}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.workbook, args.output)
