import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useApp from '../context/useApp';
import TransactionsTable from '../components/TransactionsTable';
import Pagination from '../components/Pagination.jsx';
import { SearchIcon } from '../components/icons';
import {
  TRANSACTION_SORT_OPTIONS,
  filterAndSortTransactions,
  getRiskFilterFromQuery,
} from '../utils/transactions';
import { getPageSizeChange, getTotalPages } from '../utils/pagination.js';

const riskFilters = ['All', 'Low', 'Medium', 'High'];

function EmptyTransactionsState({ hasTransactions, hasSearch }) {
  let title = 'No transactions available.';
  let guidance = 'Evaluated transactions will appear here when they are available.';

  if (hasTransactions && hasSearch) {
    title = 'No transactions found.';
    guidance = 'Try a different transaction ID, vendor, or category, or clear the filters.';
  } else if (hasTransactions) {
    title = 'No transactions match the selected filters.';
    guidance = 'Try adjusting your filters or clearing them.';
  }

  return (
    <div className="transactions-empty-state" role="status">
      <h3>{title}</h3>
      <p>{guidance}</p>
    </div>
  );
}

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
  } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('vendor') || '');
  const [ruleFilter, setRuleFilter] = useState('All');
  const riskFilter = getRiskFilterFromQuery(searchParams.get('risk'));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTransactionsSearch(search.trim());
      setTransactionsPage(1);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    search,
    setTransactionsPage,
    setTransactionsSearch,
  ]);
  const totalPages = getTotalPages(transactionsTotal, transactionsPageSize);

  useEffect(() => {
    if (!transactionsLoading && transactionsPage > totalPages) {
      setTransactionsPage(totalPages);
    }
  }, [transactionsLoading, transactionsPage, setTransactionsPage, totalPages]);

  const firstTransactionNumber = transactionsTotal === 0
    ? 0
    : ((transactionsPage - 1) * transactionsPageSize) + 1;

  const lastTransactionNumber = Math.min(
    transactionsPage * transactionsPageSize,
    transactionsTotal
  );

  const evaluatedTransactions = useMemo(
    () => transactions.filter((transaction) => !transaction?.processing),
    [transactions]
  );
  const loadedTransactionCount = transactions.length;

  const filtered = useMemo(
    () => filterAndSortTransactions(transactions, {
      search: '',
      riskFilter,
      ruleFilter,
      sortBy: transactionsSortBy,
    }),
    [
      transactions,
      riskFilter,
      ruleFilter,
      transactionsSortBy,
    ]
  );

  const clientFiltersActive = (
    riskFilter !== 'All'
    || ruleFilter !== 'All'
  );

  const filtersActive = (
    Boolean(search.trim())
    || clientFiltersActive
  );

  let resultLabel = transactionsLoading
    ? 'Loading transactions...'
    : (
      `${firstTransactionNumber.toLocaleString('en-US')}–`
      + `${lastTransactionNumber.toLocaleString('en-US')} of `
      + `${transactionsTotal.toLocaleString('en-US')} Transactions`
    );

  if (!transactionsLoading && clientFiltersActive) {
    resultLabel = (
      `${filtered.length} of ${loadedTransactionCount} Transactions `
      + `on Page ${transactionsPage}`
    );
  }

  const changePage = (nextPage) => {
    if (
      transactionsLoading
      || nextPage < 1
      || nextPage > totalPages
      || nextPage === transactionsPage
    ) {
      return;
    }

    setTransactionsPage(nextPage);
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const changePageSize = (nextPageSize) => {
    const next = getPageSizeChange(nextPageSize);
    setTransactionsPageSize(next.pageSize);
    setTransactionsPage(next.page);
  };

  const updateRiskFilter = (filter) => {
    const nextParams = new URLSearchParams(searchParams);
    if (filter === 'All') nextParams.delete('risk');
    else nextParams.set('risk', filter.toLowerCase());
    setSearchParams(nextParams);
    setTransactionsPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setTransactionsSearch('');
    setTransactionsSortBy(TRANSACTION_SORT_OPTIONS.NEWEST);
    setTransactionsPage(1);
    setRuleFilter('All');

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('risk');
    nextParams.delete('vendor');
    setSearchParams(nextParams);
  };

  return (
    <>
      <div className="page-header transactions-page-header">
        <div>
          <h1>Transactions</h1>
          <p>Browse, filter, and review evaluated transactions.</p>
        </div>
        <span className="transactions-result-count" aria-live="polite">{resultLabel}</span>
      </div>

      <div className="transactions-toolbar" aria-label="Transaction search and filters">
        <label className="transactions-search">
          <span className="control-label">Search</span>
          <span className="search-input">
            <SearchIcon width={16} height={16} color="#7b8493" aria-hidden="true" />
            <input
              placeholder="Search by transaction ID, vendor, or category"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (searchParams.get('vendor')) {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.delete('vendor');
                  setSearchParams(nextParams);
                }
              }}
            />
          </span>
        </label>

        <div className="transactions-filter-group">
          <fieldset className="filter-fieldset">
            <legend className="control-label">Risk Level</legend>
            <div className="filter-chip-group">
              {riskFilters.map((filter) => (
                <button
                  type="button"
                  key={filter}
                  className={`filter-chip${riskFilter === filter ? ' active' : ''}`}
                  aria-pressed={riskFilter === filter}
                  onClick={() => updateRiskFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="transactions-select-control">
            <span className="control-label">Rule Status</span>
            <select
              className="select-input"
              value={ruleFilter}
              onChange={(event) => {
                setRuleFilter(event.target.value);
                setTransactionsPage(1);
              }}
            >
              <option value="All">All Statuses</option>
              <option value="Passed">Passed</option>
              <option value="Review">Review</option>
            </select>
          </label>

          <label className="transactions-select-control">
            <span className="control-label">Sort By</span>
            <select
              className="select-input"
              value={transactionsSortBy}
onChange={(event) => {
  setTransactionsSortBy(event.target.value);
  setTransactionsPage(1);
}}
            >
              <option value={TRANSACTION_SORT_OPTIONS.NEWEST}>Newest</option>
              <option value={TRANSACTION_SORT_OPTIONS.OLDEST}>Oldest</option>
              {/* <option value={TRANSACTION_SORT_OPTIONS.HIGHEST_RISK}>Highest Risk</option>
              <option value={TRANSACTION_SORT_OPTIONS.LOWEST_RISK}>Lowest Risk</option> */}
              <option value={TRANSACTION_SORT_OPTIONS.HIGHEST_AMOUNT}>Highest Amount</option>
              <option value={TRANSACTION_SORT_OPTIONS.LOWEST_AMOUNT}>Lowest Amount</option>
            </select>
          </label>

          {filtersActive && (
            <button type="button" className="btn btn-secondary clear-filters-btn" onClick={clearFilters}>
              Clear Filters
            </button>
          )}
        </div>
      </div>

      <section className="card transactions-card" aria-labelledby="transactions-results-heading">
        <div className="card-header">
          <h2 id="transactions-results-heading">{resultLabel}</h2>
        </div>
        {transactionsLoading ? (
          <div className="transactions-empty-state" role="status">
            <h3>Loading transactions...</h3>
            <p>The latest transaction data is being retrieved.</p>
          </div>
        ) : transactionsError ? (
          <div className="transactions-empty-state" role="alert">
            <h3>Transactions are unavailable.</h3>
            <p>{transactionsError}</p>
          </div>
        ) : filtered.length > 0 ? (
          <TransactionsTable transactions={filtered} />
        ) : (
          <EmptyTransactionsState
            hasTransactions={evaluatedTransactions.length > 0}
            hasSearch={Boolean(search.trim())}
          />
        )}
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
    </>
  );
}
