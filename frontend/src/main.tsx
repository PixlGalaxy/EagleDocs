import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { registerServiceWorker } from './push.ts';
import { isOldHost } from './components/brand.ts';
import MovedPage from './pages/landing/MovedPage.tsx';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  // The old domains only point people to the new one.
  if (isOldHost(location.hostname)) {
    root.render(<MovedPage />);
    return;
  }

  // `npm run dev:mock` serves the whole UI against an in-browser fake backend.
  if (import.meta.env.MODE === 'mock') {
    const { installMockApi } = await import('./api/mock/index.ts');
    installMockApi();
  } else if (import.meta.env.PROD) {
    void registerServiceWorker();
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
