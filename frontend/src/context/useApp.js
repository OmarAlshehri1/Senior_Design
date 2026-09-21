import { useContext } from 'react';
import AppContext from './contextStore';

export default function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
}
