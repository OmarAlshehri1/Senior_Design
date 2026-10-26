# Production Payments reduction — 26 October 2026

The owner requested reducing the active Payments population from 355,426 to 47,531 because the system was lagging. The owner selected the recommended latest-payments policy, retaining workflow-linked records and requesting a mix of risk classifications.

Production now contains exactly **47,531 active Payments records**: **43,958 LOW**, **3,573 MEDIUM**, and **zero HIGH**. The original Payments population had no HIGH classifications under the existing rules and model, so none were fabricated or relabelled. The selected population runs from 28 April through 9 October 2026 in UTC and totals USD 4,227,090,061.09.

The same payment already linked to a review and assignment remains present. All five reviews, the existing case, eleven assignments, saved reports, and the separate 9,853 legacy transactions were preserved. The retained IDs match SHA-256 `15e98851062b5086a079eaf91e28e6a3027d3590008879d93ec34a1f5eb70b51`. The operation refuses an unexpected source population, changed selection, manual-source rows, or more protected references than the requested target.

The 307,895 excluded Payments rows, 12,968 excluded alerts and 59,593 unused vendor references were removed from the live relational tables. Their original rows are retained in a protected compressed database archive, outside application reads. It occupies 62,005,248 bytes and is not accessible with anonymous, authenticated or application service-role credentials. There are 8,524 remaining active vendor references and 3,573 retained alerts.

The existing rule results, model scores, versions and evaluation timestamps remain unchanged. They are historical results evaluated against the original 355,426-payment population. References to excluded history remain recoverable through the archive. This reduction does not retrain the model, recompute scores using an incomplete history, or create new fraud classifications. Dataset provenance explicitly records this original evaluation context.

After compacting the transactions, alerts and vendor tables and updating their planner statistics, total Production database usage fell from **341,716,115 to 175,910,035 bytes**, including the rollback archive. The database remains on Supabase Free. Measured server-side dashboard execution was 129 ms and latest-day business-report extraction was 267 ms for the same 182 latest-day payments. These measurements exclude browser and network time.

## Validation and recovery

Eight isolated PostgreSQL tests cover preview-only behavior, source/selection guards, workflow retention, unchanged scores, client-role access denial, and exact restoration of transaction, alert and vendor rows. A full-size rehearsal reduced the entire selected workbook to 47,531, compacted it, then restored all 355,426 payments, 68,117 vendors and 16,541 alerts. A digest of every complete payment row matched before and after restoration. No Production payload was exported to a local process for this operation.

Production reduction ID is `1`. The database operator can recover it with `public.restore_primary_payment_reduction(<reduction_id>)`. The application cannot invoke this function. Restoration runs atomically and does not overwrite the surviving workflow records; an ID conflict or changed retention binding aborts it. The verified original workbook and full offline result set also remain unchanged locally.

The reduction committed successfully despite the management tool's response timeout; its committed audit record was checked before any further operation. It was not retried. Table compaction completed afterward. Feed Review, Experimental Review and ingestion flags remain disabled; application code and the model artifact are unchanged.
