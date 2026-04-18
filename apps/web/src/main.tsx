// apps/web/src/main.tsx — app entry point.
// Wraps everything in TanStack Router; the Shell is the root layout.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import './styles/app.css';
import { router } from './app/Router';

const el = document.getElementById('root');
if (!el) throw new Error('#root element not found. Check index.html.');

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
