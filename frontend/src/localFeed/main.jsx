import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../refresh.css';
import './localFeed.css';
import LocalFeed from './LocalFeed.jsx';

const local = import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
createRoot(document.getElementById('root')).render(
  <StrictMode>{local ? <LocalFeed /> : <p>This view is available in a local simulation session only.</p>}</StrictMode>,
);
