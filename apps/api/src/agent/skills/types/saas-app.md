# SaaS app type SOP — runtime rules for executor + polish

This SOP applies to projects of type `saas-app`. Full-stack: marketing landing,
auth flow, product dashboard, billing, all wired to Supabase.

## File layout

```
apps/
  web/                       # marketing + product (Vite + React)
    src/
      pages/marketing/       # uses landing-page patterns
        Index.tsx
        Pricing.tsx
        About.tsx
      pages/auth/
        Login.tsx
        Signup.tsx
        ForgotPassword.tsx
      pages/app/             # uses dashboard patterns, behind auth
        Overview.tsx
        Settings.tsx
        Billing.tsx
      lib/
        supabase.ts          # client init from import.meta.env.VITE_SUPABASE_*
        auth.ts
        api.ts
  api/                       # optional Fastify backend for webhooks/cron
    src/server.ts
supabase/
  migrations/                # SQL migrations, timestamped
  seed.sql
.env.example                 # placeholder values, never real secrets
```

## Auth flow

Use Supabase Auth. Standard flows:

- Email + password signup → email confirmation → first-login onboarding
- Magic link sign-in
- OAuth (Google, GitHub) when planner config requests it

Routes:

- `/` `/pricing` `/about` — public marketing
- `/login` `/signup` `/forgot-password` — public auth
- `/app/*` — wrapped in `<RequireAuth>`

## Database — Row Level Security

Every table that touches user data has RLS enabled. Policies follow this shape:

```sql
alter table public.projects enable row level security;

create policy "users read own projects"
  on public.projects for select
  using (auth.uid() = owner_id);

create policy "users insert own projects"
  on public.projects for insert
  with check (auth.uid() = owner_id);
```

Never write a table with RLS disabled. Service-role queries only happen in the
Fastify backend, never in the browser.

## Billing

If billing is in scope:

- Stripe Checkout for paid plans (no card collection in our UI)
- Stripe customer portal for plan management
- Webhook receiver in `apps/api` validates signature with `STRIPE_WEBHOOK_SECRET`
- `subscriptions` table mirrors Stripe state, updated via webhook only

## Marketing site

Follow `landing-page.md` patterns inside `pages/marketing/`. Hero CTA points to
`/signup`. Pricing CTAs point to Stripe Checkout (or `/signup` if free tier).

## Product dashboard

Follow `dashboard.md` patterns inside `pages/app/`. Sidebar nav, KPI overview,
entity pages, settings.

## Security rules (hard, enforced)

- NEVER ship `SUPABASE_SERVICE_ROLE_KEY` to the browser bundle
- Browser uses anon key only; service role lives in `apps/api` env
- Every user-data table has RLS enabled with explicit policies
- All Stripe webhook handlers verify signatures before reading body
- `.env` files are gitignored; only `.env.example` is committed
- Password reset and email change flows use Supabase's built-in tokens, never roll your own
- CORS on `apps/api` allowlists only the marketing/app origins

## SEO rules (marketing pages)

- Per `landing-page.md`: title ≤ 60, description ≤ 160, one h1, OG tags, JSON-LD
- Sitemap.xml generated at build for marketing routes only
- `/app/*` routes carry `<meta name="robots" content="noindex">`

## Quality rules

- TypeScript strict
- All API calls go through `lib/api.ts` or supabase client
- Public pages SSR-friendly (or pre-rendered) when planner requests
- Loading + empty + error states everywhere

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command`,
`gen_image`, `supabase_migration` (writes a SQL file, doesn't apply)
Phase B' (humanizer): `humanize_doc` for marketing copy
Phase C (polish): `read_file`, `write_file`, `lint`, `typecheck`, `secret_scan`
