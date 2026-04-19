// apps/web/src/main.tsx — app entry point.
// Initialises auth store before mounting the router so the session is
// available synchronously for route guards.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import './styles/app.css';
import { router } from './app/Router';
import { useAuthStore } from './lib/store/authStore';

// Kick off session hydration immediately (async, sets loading → false when done)
useAuthStore.getState().init();

const el = document.getElementById('root');
if (!el) throw new Error('#root element not found. Check index.html.');

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
