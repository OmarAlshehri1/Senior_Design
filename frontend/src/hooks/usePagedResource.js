import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPagedResource } from '../utils/pagedResource.js';

export default function usePagedResource(loader, initialQuery) {
  const [resource] = useState(() => createPagedResource(loader, initialQuery));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    resource.load();
    return resource.cancel;
  }, [resource]);
  return { ...snapshot, resource };
}
