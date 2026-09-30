import { useContext } from 'react';
import AuthorizationContext from './authorizationStore.js';

export default function useAuthorization() {
  const context = useContext(AuthorizationContext);
  if (!context) throw new Error('useAuthorization must be used within AuthorizationProvider.');
  return context;
}
