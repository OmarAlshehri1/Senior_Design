"""Write an offline illustrative memorandum; never read or write a database."""
import argparse
from pathlib import Path

from app.services.business_reports import build_document, render_business_html, build_business_workbook
from app.services.business_report_pdf import build_business_pdf


def demonstration_source():
    transactions = []
    for index, amount, currency, risk, level in [(1,500,'SAR',88,'HIGH'),(2,250,'USD',60,'MEDIUM'),(3,None,None,None,None)]:
        transactions.append({
            'id': f'DEMO-00{index}', 'timestamp': '2026-10-03T12:00:00Z',
            'vendor_name': 'Illustrative Demo Supplier', 'amount': amount, 'currency': currency,
            'data_quality_status': 'PARTIAL', 'missing_fields': ['approval_limit'],
            'evaluation_id': index, 'evaluation_version': '1.0.0', 'evaluated_at': '2026-10-04T01:00:00Z',
            'rule_results': [
                {'rule_key':'ghost_vendors','rule_name':'Ghost Vendors','rule_version':'1.0.0','status':'FAILED',
                 'detail':'Demonstration: vendor registry membership requires review.','evidence':{'vendor_registered':False}},
                {'rule_key':'approval_limits','rule_name':'Approval Limits','rule_version':'1.0.0','status':'NOT_EVALUATED',
                 'detail':'Approval limit is not supplied.','evidence':{'missing_fields':['approval_limit']}},
            ] if index<3 else [],
            'risk_snapshot_id':index if risk else None,'scoring_version':'1.0.0' if risk else None,
            'rule_evaluation_version':'1.0.0' if risk else None,'anomaly_model_version':'1.0.0' if risk else None,
            'calculated_at':'2026-10-04T01:01:00Z' if risk else None,
            'rule_score':80 if index==1 else 50 if index==2 else None,
            'ai_score':100 if index==1 else 75 if index==2 else None,
            'risk_score':risk,'risk_level':level,
        })
    return {'organization_name':'Illustrative Retail Organization — DEMO',
            'prepared_by':{'id':'offline-preview','name':'Offline demonstration','role':'ADMIN'},
            'scope':'ORGANIZATION','team_id':None,'team_name':None,
            'period_start':'2026-10-03T00:00:00Z','period_end':'2026-10-04T00:00:00Z',
            'as_of':'2026-10-19T10:30:00Z','undated_in_scope':0,
            'transactions':transactions,
            'alerts':[{'id':'DEMO-ALERT-1','transaction_id':'DEMO-001','severity':'HIGH','status':'ACTIVE',
                       'created_at':'2026-10-04T01:02:00Z','reviewed_at':None}],
            'cases':[]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-directory',type=Path,default=Path(__file__).resolve().parents[2]/'docs'/'evidence')
    args = parser.parse_args()
    document = build_document(demonstration_source(), recipient='Management — illustrative recipient',
                              sender='Automated reporting service — offline demonstration',data_context='DEMONSTRATION')
    report = {'id':'00000000-0000-4000-8000-000000000025','created_at':'2026-10-19T10:31:00Z','document':document}
    args.output_directory.mkdir(parents=True,exist_ok=True)
    html_path = args.output_directory/'business_report_preview.html'
    excel_path = args.output_directory/'business_report_preview.xlsx'
    pdf_path = args.output_directory/'business_report_preview.pdf'
    html_path.write_text(render_business_html(report),encoding='utf-8')
    excel_path.write_bytes(build_business_workbook(report))
    pdf_path.write_bytes(build_business_pdf(report))
    print('Created offline DEMONSTRATION preview (3 illustrative records, not production evidence).')
    print(html_path)
    print(excel_path)
    print(pdf_path)


if __name__=='__main__':
    main()
