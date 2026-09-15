import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { useLocale } from './i18n/index.js';
import './styles/app.css';
import './styles/print-sheet.css';

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

/** Remounts the whole tree on a locale switch — the simplest way to guarantee
 * every SRD lookup and component re-renders with the new language. */
function Root() {
  const locale = useLocale();
  return <App key={locale} />;
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
