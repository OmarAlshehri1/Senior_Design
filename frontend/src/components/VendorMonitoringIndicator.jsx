import { VENDOR_STATUS_META, VENDOR_STATUSES } from '../vendors/vendorModel.js';

export default function VendorMonitoringIndicator({ status }) {
  if (!Object.values(VENDOR_STATUSES).includes(status)) return null;
  const label = VENDOR_STATUS_META[status].transactionLabel;
  if (!label) return null;
  return <span className={`vendor-monitoring-indicator vendor-${status.toLowerCase()}`}>{label}</span>;
}
