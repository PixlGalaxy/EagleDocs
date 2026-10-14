import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { registerServiceWorker } from './push.ts';

async function boot() {
  // `npm run dev:mock` serves the whole UI against an in-browser fake backend.
  if (import.meta.env.MODE === 'mock') {
    const { installMockApi } = await import('./api/mock/index.ts');
    installMockApi();
  } else if (import.meta.env.PROD) {
    void registerServiceWorker();
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
