# Dashboard type SOP — runtime rules for executor + polish

This SOP applies to projects of type `dashboard`. React + Vite SPA with sidebar
nav, KPI cards, charts, and tables behind an auth gate.

## File layout

```
package.json
vite.config.ts
index.html
src/
  main.tsx
  App.tsx
  routes.tsx                 # react-router v6 route table
  lib/
    api.ts                   # fetch wrapper with auth header
    auth.ts                  # session getter + guard
    format.ts                # number/date formatters
  components/
    Sidebar.tsx
    Topbar.tsx
    KpiCard.tsx
    LineChart.tsx            # recharts wrapper
    DataTable.tsx            # paginated, sortable, filterable
    FilterBar.tsx
    EmptyState.tsx
  pages/
    Login.tsx
    Overview.tsx             # KPI cards + main chart
    <entity>.tsx             # one per resource (e.g. Users, Orders)
    Settings.tsx
public/
  favicon.svg
```

Build target: Vite, React 18, TypeScript, Tailwind, Recharts, react-router v6.

## Standard layout shell

```tsx
<div className="flex h-screen bg-slate-50">
  <Sidebar />
  <div className="flex-1 flex flex-col overflow-hidden">
    <Topbar />
    <main className="flex-1 overflow-y-auto p-6">
      <Outlet />
    </main>
  </div>
</div>
```

Sidebar is collapsible. Active route is highlighted via `NavLink`.

## Auth gate

```tsx
function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  return children;
}
```

Wrap every authenticated route. The Login page is the only unauthenticated
route. Session is read from Supabase client or a JWT in `localStorage`.

## KPI cards

Each card shows: label, current value, delta vs previous period, sparkline.
Use 3–5 cards across the top of Overview.

```tsx
<KpiCard
  label="MRR"
  value={formatCurrency(stats.mrr)}
  delta={stats.mrrDelta}
  series={stats.mrrSeries}
/>
```

## Charts

Use Recharts. Time-series uses `LineChart` or `AreaChart`. Always render an
`<EmptyState />` when the dataset is empty — never a blank chart.

## Data tables

`DataTable` is paginated (server- or client-side per plan), sortable per column,
and has a sticky header. The `FilterBar` above the table holds search + facet
filters. Bulk-select rows expose row actions in a toolbar that appears on
selection.

## Empty / loading / error states

Every async surface has all three states:

- Loading: skeleton rows / shimmer
- Empty: illustration + 1-line explanation + primary action
- Error: message + retry button + link to status page if configured

Never show a flicker of empty content while loading.

## Security rules (hard, enforced)

- NEVER hardcode API keys, service role keys, or DB passwords. Use `import.meta.env.VITE_*`.
- Only `VITE_` prefixed env vars are allowed in client bundle. `SERVICE_ROLE_KEY` is forbidden.
- All API calls go through `lib/api.ts` which attaches the bearer token.
- Render user-supplied strings via React (auto-escaped). NEVER `dangerouslySetInnerHTML`
  on user content.
- Auth gate must wrap every route except `/login`.
- CSP `connect-src` allowlist is set in `index.html` meta tag for Supabase / API origins.

## Quality rules

- TypeScript strict mode on
- ESLint + Prettier configured
- All `fetch` calls handle non-2xx responses
- Forms use controlled inputs with client-side validation
- All numeric formatting goes through `lib/format.ts` (locale-aware)
- Mobile responsive: sidebar collapses to drawer on `< md`

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command` (npm install + build)
Phase B' (humanizer): not applicable (UI strings only)
Phase C (polish): `read_file`, `write_file`, `list_files`, `lint`, `typecheck`
