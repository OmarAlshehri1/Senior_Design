# Departments in Feed Review and summary exports

Feed Review shows the imported department/category for each listed transaction
and in its saved detail. Blank/whitespace/missing classifications display as
Uncategorized; surrounding whitespace is trimmed. Values are not inferred from
amounts, suppliers or actor IDs, and existing transaction records are not rewritten.

The summary groups the entire authorized report population by department and
currency. It reports transaction counts, processed counts, rule-flagged counts
and exact recorded amounts. Currency amounts remain separate. Missing amounts
remain unavailable. Existing source, current team, role and receipt-period
restrictions apply before aggregation. Pending validation receipts remain
outside the canonical feed population as in the existing report.

For bounded output, the largest 100 department/currency groups are shown with
the full group count and a truncation label. Source-level overall counts and
currency totals still cover the entire authorized population. The transaction
schedule remains limited to the latest 100 transactions, with its coverage shown.

PDF includes the grouped breakdown and department labels in the transaction
schedule. Excel includes the existing summary plus structured Departments and
Transactions sheets, filters, frozen headings and wrapped text. Exact amounts
remain text to avoid spreadsheet precision loss. Imported labels and references
are explicitly stored as text so they cannot become spreadsheet formulas.

Migration: `20261102033856_feed_department_reporting.sql`. It replaces only the
existing read projections, preserves service-only ACLs and authorization checks,
and sets a bounded aggregate RPC timeout. The backend gives that report RPC
60 seconds. No dataset replay/reset or raw/validated/audited record update is
part of the change.

Staging verification covers isolated SQL source/team/period checks, missing
labels, multiple currencies, precision, output limits, PDF/XLSX content and safe
spreadsheet values, then actual hosted API and browser reads. Production rollout
is a separate step. The load-test workers continue using existing durable jobs.
