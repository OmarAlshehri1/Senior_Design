"""Loopback browser acceptance against the synthetic company_imports_local host."""
import argparse
import csv
import json
from pathlib import Path
import secrets
import subprocess
import sys
import time
from urllib.parse import urlsplit

import httpx
from openpyxl import Workbook
from websockets.sync.client import connect

from scripts.check_payment_local_ui import CDP, check
from app.services.company_imports import MAX_ROWS, MAX_FILE

ROOT = Path(__file__).resolve().parents[2]


def run(url, evidence):
    target = urlsplit(url)
    check(target.scheme == 'http' and target.hostname == '127.0.0.1' and target.path == '/company-import-check.html', 'LOOPBACK_FIXTURE_REQUIRED')
    check(not evidence.exists(), 'EVIDENCE_ALREADY_EXISTS')
    work = ROOT/'backend/.feed-simulator'/('company-import-browser-'+secrets.token_hex(5))
    profile = work/'chrome'
    profile.mkdir(parents=True)
    fields = ['reference', 'amount', 'currency', 'timestamp', 'vendor_id', 'vendor_name', 'invoice_number', 'created_by', 'approved_by', 'category', 'approver_role']
    run_id = secrets.token_hex(4)
    values = ['CSV-BROWSER-'+run_id, '1000000000', 'SAR', '2026-01-02T12:00:00Z', 'V-UNKNOWN', 'Synthetic vendor', 'BROWSER-INV-1', 'ACTOR-1', 'ACTOR-1', 'Inventory', 'Manager']
    csv_path = work/'synthetic.csv'
    with csv_path.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream); writer.writerow(fields); writer.writerow(values)
    invalid = work/'invalid.csv'
    with invalid.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream); writer.writerow(fields); writer.writerow(['INVALID-1', 'wrong', *values[2:]])
    conflicting = work/'conflict.csv'
    with conflicting.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream); writer.writerow(fields); writer.writerow([values[0], '12', *values[2:]])
    excel = work/'synthetic.xlsx'
    workbook = Workbook(); workbook.active.title = 'Notes'; workbook.active.append(['Notes']); workbook.active.append(['Choose Transactions'])
    worksheet = workbook.create_sheet('Transactions'); worksheet.append(fields); worksheet.append(['XLSX-BROWSER-'+run_id, *values[1:]]); workbook.save(excel)
    browser = subprocess.Popen([r'C:\Program Files\Google\Chrome\Application\chrome.exe', '--headless=new', '--disable-gpu',
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        f'--user-data-dir={profile}', 'about:blank'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        marker = profile/'DevToolsActivePort'
        for _ in range(100):
            if marker.exists(): break
            time.sleep(.1)
        check(marker.exists(), 'CHROME_NOT_READY')
        port = int(marker.read_text().splitlines()[0])
        with httpx.Client(trust_env=False) as client:
            page = next(p for p in client.get(f'http://127.0.0.1:{port}/json/list').json() if p['type'] == 'page')
        with connect(page['webSocketDebuggerUrl'], proxy=None, max_size=20*1024*1024) as channel:
            cdp = CDP(channel)
            for domain in ('Page', 'Runtime', 'Network'): cdp.call(domain+'.enable')
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 1100, 'deviceScaleFactor': 1, 'mobile': False})
            cdp.call('Page.navigate', {'url': url})
            cdp.wait("[...document.querySelectorAll('select option')].some(o=>o.value==='fixture-company')")
            limits_label = f'{MAX_ROWS:,} rows and {MAX_FILE // (1024 * 1024)} MiB'
            check(cdp.evaluate(f'document.body.textContent.includes({json.dumps(limits_label)})'), 'SERVER_LIMITS_NOT_DISPLAYED')
            def field(label, value):
                check(cdp.evaluate("""(() => {const l=[...document.querySelectorAll('label')].find(l=>l.firstChild.textContent.trim()===LABEL);
                    if(!l)return false;const e=l.querySelector('input,select');
                    Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,VALUE);
                    e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true;})()""".replace('LABEL', json.dumps(label)).replace('VALUE', json.dumps(value))), 'FIELD_MISSING_'+label)
            def upload(path):
                root = cdp.call('DOM.getDocument')['root']['nodeId']
                node = cdp.call('DOM.querySelector', {'nodeId': root, 'selector': 'input[type=file]'})['nodeId']
                cdp.call('DOM.setFileInputFiles', {'nodeId': node, 'files': [str(path)]})
                cdp.wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Read file'&&!b.disabled)")
                cdp.click('Read file')
                cdp.wait("document.querySelector('section[aria-label=\"Column mapping\"]') && !document.querySelector('section[aria-label=\"Column mapping\"] fieldset').disabled")
            field('Company source', 'fixture-company')
            upload(csv_path)
            field('Unique transaction reference', 'reference')
            labels = {'amount': 'Amount', 'currency': 'Currency', 'timestamp': 'Transaction date / time', 'vendor_id': 'Supplier reference', 'vendor_name': 'Supplier name',
                'invoice_number': 'Invoice number', 'created_by': 'Created by', 'approved_by': 'Approved by', 'category': 'Department / category', 'approver_role': 'Approver role'}
            for key, label in labels.items(): field(label, key)
            field('Allowed currency codes (e.g. USD,SAR)', 'SAR')
            field('Actor ID system (when actor columns are mapped)', 'fixture-actors')
            field('Supplier ID system (when supplier reference is mapped)', 'fixture-vendors')
            cdp.click('Check all rows')
            cdp.wait("Boolean(document.querySelector('section[aria-label=\"Import preview\"]'))")
            field('Save mapping as (optional)', 'Browser mapping')
            cdp.click('Confirm import')
            cdp.wait("[...document.querySelectorAll('section[aria-label=\"Import progress\"] dl>div')].some(v=>v.querySelector('dt').textContent==='completed'&&v.querySelector('dd').textContent==='1')")
            cdp.screenshot(work/'csv-completed.png')
            # Exact file replay uses the saved mapping and original receipt.
            upload(csv_path)
            cdp.wait("[...document.querySelectorAll('option')].some(o=>o.value==='Browser mapping')")
            field('Saved mapping', 'Browser mapping')
            cdp.click('Check all rows')
            cdp.wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Confirm import'&&!b.disabled)")
            cdp.click('Confirm import')
            cdp.wait("[...document.querySelectorAll('section[aria-label=\"Import progress\"] dl>div')].some(v=>v.querySelector('dt').textContent==='duplicates'&&v.querySelector('dd').textContent==='1')")
            upload(conflicting); field('Saved mapping', 'Browser mapping'); cdp.click('Check all rows')
            cdp.wait("Boolean(document.querySelector('section[aria-label=\"Import preview\"] [role=alert]')?.textContent.includes('Existing references'))")
            check(cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm import').disabled"), 'CONFLICTING_IMPORT_ENABLED')
            # Invalid input remains a preview and cannot be confirmed.
            upload(invalid); field('Saved mapping', 'Browser mapping'); cdp.click('Check all rows')
            cdp.wait("Boolean(document.querySelector('section[aria-label=\"Import preview\"] [role=alert]'))")
            check(cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm import').disabled"), 'INVALID_IMPORT_ENABLED')
            # XLSX sheet selection uses the same mapping and worker pipeline.
            upload(excel); field('Worksheet', 'Transactions')
            cdp.wait("document.querySelector('section[aria-label=\"Column mapping\"]')?.textContent.includes('1 rows')&&!document.querySelector('section[aria-label=\"Column mapping\"] fieldset')?.disabled")
            field('Saved mapping', 'Browser mapping'); cdp.click('Check all rows')
            cdp.wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Confirm import'&&!b.disabled)")
            cdp.click('Confirm import')
            cdp.wait("[...document.querySelectorAll('section[aria-label=\"Import progress\"] dl>div')].some(v=>v.querySelector('dt').textContent==='completed'&&v.querySelector('dd').textContent==='1')")
            previous_page = cdp.evaluate('performance.timeOrigin')
            cdp.call('Page.reload')
            cdp.wait(f"performance.timeOrigin!=={previous_page}&&document.readyState==='complete'")
            cdp.wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Check processing'&&!b.disabled)")
            cdp.click('Check processing')
            cdp.wait("[...document.querySelectorAll('section[aria-label=\"Import progress\"] dl>div')].some(v=>v.querySelector('dt').textContent==='completed'&&v.querySelector('dd').textContent==='1')")
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
            check(cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'MOBILE_PAGE_OVERFLOW')
            cdp.screenshot(work/'mobile-completed.png')
            check(cdp.exceptions == 0, 'RUNTIME_EXCEPTION')
            check(cdp.hosts <= {'127.0.0.1'}, 'NONLOCAL_REQUEST')
            result = {'status': 'PASS', 'story': 'Browser file -> real API -> local PostgreSQL -> real validation/audit workers -> displayed progress',
                'checks': ['server-advertised upload limits displayed', 'CSV mapping and confirmed completion', 'saved mapping reuse', 'identical-file deduplication', 'existing-reference conflict preview blocks confirmation', 'invalid-row confirmation disabled', 'XLSX worksheet selection and completed auditing', 'progress restored from history after reload', '390px no page overflow', 'zero runtime exceptions', 'loopback-only requests'],
                'identity': 'substituted synthetic Admin; hosted authentication not tested', 'database': 'in-memory PGlite; no hosted state changed', 'private_artifacts': str(work.relative_to(ROOT))}
            evidence.write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result))
    finally:
        browser.terminate()
        browser.wait(timeout=15)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    run(args.url, args.evidence)
