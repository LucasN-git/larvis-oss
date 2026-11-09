import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installVisualViewport } from './lib/visualViewport';
import '@fontsource-variable/plus-jakarta-sans';
import './theme/global.css';
import './theme/components.css';
import './features/features.css';

installVisualViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
