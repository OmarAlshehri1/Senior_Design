import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useApp from '../context/useApp';
import TransactionsTable from '../components/TransactionsTable';
import Pagination from '../components/Pagination.jsx';
import { EMPTY_TRANSACTION_FILTERS, TRANSACTION_SORT_OPTIONS } from '../utils/transactions';
import { getPageSizeChange, getTotalPages } from '../utils/pagination.js';
import { PageHeader } from '../components/ui/Layout.jsx';
import { Combobox, FilterBar, SearchField, SegmentedControl, SelectField } from '../components/ui/Filters.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';

const SORT_LABELS = Object.freeze({
  [TRANSACTION_SORT_OPTIONS.NEWEST]: 'Newest',
  [TRANSACTION_SORT_OPTIONS.OLDEST]: 'Oldest',
  [TRANSACTION_SORT_OPTIONS.HIGHEST_RISK]: 'Highest risk',
  [TRANSACTION_SORT_OPTIONS.LOWEST_RISK]: 'Lowest risk',
  [TRANSACTION_SORT_OPTIONS.HIGHEST_AMOUNT]: 'Highest amount',
  [TRANSACTION_SORT_OPTIONS.LOWEST_AMOUNT]: 'Lowest amount',
});
const AMOUNT_AND_DATE_SORTS = [TRANSACTION_SORT_OPTIONS.NEWEST, TRANSACTION_SORT_OPTIONS.OLDEST, TRANSACTION_SORT_OPTIONS.HIGHEST_AMOUNT, TRANSACTION_SORT_OPTIONS.LOWEST_AMOUNT];
const RISK_OPTIONS = [{ value: '', label: 'All' }, { value: 'low', label: 'Low', tone: 'low' }, { value: 'medium', label: 'Medium', tone: 'medium' }, { value: 'high', label: 'High', tone: 'high' }];
const RULE_STATUS_OPTIONS = [{ value: '', label: 'All' }, { value: 'passed', label: 'Passed' }, { value: 'review', label: 'Needs review' }];

export default function Transactions() {
  const {
    transactions,
    transactionsLoading,
    transactionsError,
    transactionsTotal,
    transactionsPage,
    transactionsPageSize,
    setTransactionsPageSize,
    setTransactionsPage,
    setTransactionsSearch,
    transactionsSortBy,
    setTransactionsSortBy,
    transactionsFilters = EMPTY_TRANSACTION_FILTERS,
    setTransactionsFilters,
    transactionFilterOptions,
  } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('vendor') || '');
  const options = transactionFilterOptions?.status === 'success' ? transactionFilterOptions.value : null;
  const optionsLoading = transactionFilterOptions?.status === 'loading';
  const riskLevels = options?.risk_levels ?? [];
  const ruleStatuses = options?.rule_statuses ?? [];
  const categories = options?.categories ?? [];
  const sorts = options?.sorts ?? AMOUNT_AND_DATE_SORTS;
  const requestedRisk = searchParams.get('risk');
  // A risk deep link is honored only as an authoritative server filter.
  const deepLinkPending = requestedRisk !== null && optionsLoading;
  const unavailableRiskView = requestedRisk !== null && !optionsLoading && !riskLevels.includes(requestedRisk);

  useEffect(() => {
    if (requestedRisk === null || !riskLevels.includes(requestedRisk)) return;
    setTransactionsFilters?.((current) => ({ ...current, risk: requestedRisk }));
    setTransactionsPage(1);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('risk');
    setSearchParams(nextParams, { replace: true });
  }, [requestedRisk, riskLevels, searchParams, setSearchParams, setTransactionsFilters, setTransactionsPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTransactionsSearch(search.trim());
      setTransactionsPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, setTransactionsPage, setTransactionsSearch]);

  const totalPages = getTotalPages(transactionsTotal, transactionsPageSize);

  useEffect(() => {
    if (!transactionsLoading && transactionsPage > totalPages) setTransactionsPage(totalPages);
  }, [transactionsLoading, transactionsPage, setTransactionsPage, totalPages]);

  const firstTransactionNumber = transactionsTotal === 0 ? 0 : ((transactionsPage - 1) * transactionsPageSize) + 1;
  const lastTransactionNumber = Math.min(transactionsPage * transactionsPageSize, transactionsTotal);

  const activeFilters = [search.trim(), transactionsFilters.risk, transactionsFilters.ruleStatus, transactionsFilters.category,
    transactionsSortBy !== TRANSACTION_SORT_OPTIONS.NEWEST].filter(Boolean).length;
  const summary = transactionsLoading ? 'Loading transactions…'
    : transactionsError ? 'Transactions unavailable'
      : `${transactionsTotal.toLocaleString('en-US')} ${transactionsTotal === 1 ? 'transaction' : 'transactions'}${activeFilters ? ' match your filters' : ''}`;

  const setFilter = (key, value) => {
    setTransactionsFilters?.((current) => ({ ...current, [key]: value }));
    setTransactionsPage(1);
  };

  const changePage = (nextPage) => {
    if (transactionsLoading || nextPage < 1 || nextPage > totalPages || nextPage === transactionsPage) return;
    setTransactionsPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changePageSize = (nextPageSize) => {
    const next = getPageSizeChange(nextPageSize);
    setTransactionsPageSize(next.pageSize);
    setTransactionsPage(next.page);
  };

  const clearFilters = () => {
    setSearch('');
    setTransactionsSearch('');
    setTransactionsSortBy(TRANSACTION_SORT_OPTIONS.NEWEST);
    setTransactionsFilters?.(EMPTY_TRANSACTION_FILTERS);
    setTransactionsPage(1);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('risk');
    nextParams.delete('vendor');
    setSearchParams(nextParams);
  };

  if (unavailableRiskView || deepLinkPending) {
    return (
      <div className="page transactions-page">
        <PageHeader title="Transactions" description="Find a payment and review its audit result." />
        <section className="panel">
          {deepLinkPending ? <LoadingState message="Loading risk view…" />
            : <EmptyState title="This risk view is unavailable." message="You can browse all transactions or search by transaction or vendor."
              action={<button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>View all transactions</button>} />}
        </section>
      </div>
    );
  }

  return (
    <div className="page transactions-page">
      <PageHeader title="Transactions" description="Find a payment and review its audit result." />

      <FilterBar label="Transaction search and filters" summary={summary} activeCount={activeFilters} onClear={clearFilters}>
        <SearchField label="Search transactions" value={search} placeholder="Search by transaction ID or vendor"
          onChange={(value) => {
            setSearch(value);
            if (searchParams.get('vendor')) {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.delete('vendor');
              setSearchParams(nextParams);
            }
          }} />
        {riskLevels.length > 0 && <SegmentedControl label="Risk" value={transactionsFilters.risk}
          options={RISK_OPTIONS.filter((option) => !option.value || riskLevels.includes(option.value))} onChange={(value) => setFilter('risk', value)} />}
        {ruleStatuses.length > 0 && <SelectField label="Rule status" value={transactionsFilters.ruleStatus}
          options={RULE_STATUS_OPTIONS.filter((option) => !option.value || ruleStatuses.includes(option.value))} onChange={(value) => setFilter('ruleStatus', value)} />}
        {categories.length > 6
          ? <Combobox label="Category" value={transactionsFilters.category} allLabel="All categories" placeholder="Type a category"
            options={categories.map((value) => ({ value, label: value }))} onChange={(value) => setFilter('category', value)} />
          : categories.length > 0 && <SelectField label="Category" value={transactionsFilters.category}
            options={[{ value: '', label: 'All' }, ...categories.map((value) => ({ value, label: value }))]} onChange={(value) => setFilter('category', value)} />}
        <SelectField label="Sort" value={transactionsSortBy}
          options={Object.keys(SORT_LABELS).filter((value) => sorts.includes(value)).map((value) => ({ value, label: SORT_LABELS[value] }))}
          onChange={(value) => { setTransactionsSortBy(value); setTransactionsPage(1); }} />
      </FilterBar>

      <section className="panel panel-table" aria-label="Transaction results" aria-busy={transactionsLoading}>
        {transactionsLoading ? <LoadingState message="Loading transactions…" />
          : transactionsError ? <ErrorState title="Transactions are unavailable." message={transactionsError} />
            : transactions.length > 0 ? <TransactionsTable transactions={transactions} />
              : activeFilters ? <EmptyState filtered title="No transactions match these filters." message="Try a different search, or clear the filters."
                action={<button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>} />
                : <EmptyState title="No transactions yet." message="Evaluated payments will appear here." />}
        {!transactionsLoading && !transactionsError && (
          <Pagination
            currentPage={transactionsPage}
            totalPages={totalPages}
            pageSize={transactionsPageSize}
            firstItem={firstTransactionNumber}
            lastItem={lastTransactionNumber}
            totalItems={transactionsTotal}
            disabled={transactionsLoading}
            onPageChange={changePage}
            onPageSizeChange={changePageSize}
          />
        )}
      </section>
    </div>
  );
}
