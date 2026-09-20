import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import TransactionsTable from '../components/TransactionsTable';
import { SearchIcon } from '../components/icons';

const riskFilters = ['All', 'Low', 'Medium', 'High'];

export default function Transactions() {
  const { transactions } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('vendor') || '');
  const [riskFilter, setRiskFilter] = useState('All');
  const [ruleFilter, setRuleFilter] = useState('All');
  const [sortBy, setSortBy] = useState('none');

  const filtered = useMemo(() => {
    let list = transactions.filter((t) => !t.processing);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.vendor.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      );
    }

    if (riskFilter !== 'All') {
      list = list.filter((t) => t.status === `${riskFilter} Risk`);
    }

    if (ruleFilter !== 'All') {
      list = list.filter((t) => t.ruleStatus === ruleFilter);
    }

    if (sortBy === 'desc') {
      list = [...list].sort((a, b) => b.riskScore - a.riskScore);
    } else if (sortBy === 'asc') {
      list = [...list].sort((a, b) => a.riskScore - b.riskScore);
    }

    return list;
  }, [transactions, search, riskFilter, ruleFilter, sortBy]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p>Browse and filter all evaluated transactions.</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SearchIcon width={15} height={15} color="#9aa1ae" />
          <input
            style={{ border: 'none', outline: 'none', width: '100%', fontSize: 13.5 }}
            placeholder="Search by ID, vendor, or category..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (searchParams.get('vendor')) setSearchParams({});
            }}
          />
        </div>

        <div className="filter-chip-group">
          {riskFilters.map((f) => (
            <button
              key={f}
              className={`filter-chip${riskFilter === f ? ' active' : ''}`}
              onClick={() => setRiskFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <select className="select-input" value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)}>
          <option value="All">All Rule Statuses</option>
          <option value="Passed">Passed</option>
          <option value="Review">Review</option>
        </select>

        <select className="select-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="none">Sort by Risk Score</option>
          <option value="desc">Risk Score: High to Low</option>
          <option value="asc">Risk Score: Low to High</option>
        </select>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{filtered.length} Transactions</h2>
        </div>
        {filtered.length > 0 ? (
          <TransactionsTable transactions={filtered} />
        ) : (
          <p style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13.5 }}>
            No transactions match your filters.
          </p>
        )}
      </div>
    </>
  );
}
