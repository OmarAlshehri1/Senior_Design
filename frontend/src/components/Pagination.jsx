import {
  getPaginationItems,
  getPaginationState,
  PAGE_SIZE_OPTIONS,
} from '../utils/pagination.js';

export default function Pagination({
  currentPage,
  totalPages,
  pageSize,
  firstItem,
  lastItem,
  totalItems,
  itemLabel = 'transactions',
  disabled = false,
  onPageChange,
  onPageSizeChange,
}) {
  const items = getPaginationItems(currentPage, totalPages);
  const { previousDisabled, nextDisabled } = getPaginationState(currentPage, totalPages);

  return (
    <div className="pagination-bar">
      <p className="pagination-summary" aria-live="polite">
        Showing {firstItem.toLocaleString('en-US')}–{lastItem.toLocaleString('en-US')} of{' '}
        {totalItems.toLocaleString('en-US')} {itemLabel}
      </p>

      <nav className="pagination-pages" aria-label={`${itemLabel} pages`}>
        <button
          type="button"
          className="pagination-button pagination-direction"
          disabled={disabled || previousDisabled}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>

        <div className="pagination-number-list">
          {items.map((item) => (
            typeof item === 'number' ? (
              <button
                type="button"
                className={`pagination-button pagination-number${item === currentPage ? ' is-current' : ''}`}
                aria-label={`Page ${item}`}
                aria-current={item === currentPage ? 'page' : undefined}
                disabled={disabled}
                key={item}
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            ) : (
              <span className="pagination-ellipsis" aria-hidden="true" key={item}>…</span>
            )
          ))}
        </div>

        <button
          type="button"
          className="pagination-button pagination-direction"
          disabled={disabled || nextDisabled}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </nav>

      <label className="pagination-page-size">
        <span>Rows per page</span>
        <select
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option value={option} key={option}>{option}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
