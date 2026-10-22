import Pagination from './Pagination.jsx';
import { pageContext } from '../utils/pagedResource.js';

export default function CollectionPagination({ collection, itemLabel, disabled = false }) {
  if (collection.status !== 'success') return null;
  return <Pagination {...pageContext(collection)} itemLabel={itemLabel} disabled={disabled}
    onPageChange={collection.resource.setPage} onPageSizeChange={collection.resource.setPageSize} />;
}
