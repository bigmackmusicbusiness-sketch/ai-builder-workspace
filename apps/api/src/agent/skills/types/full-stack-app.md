# Full-stack app type SOP — runtime rules for executor + polish

This SOP applies to projects of type `full-stack-app`. Generic FE + BE
monorepo. When the brief is ambiguous between `full-stack-app` and `saas-app`,
prefer `saas-app` patterns (auth + billing + RLS).

## File layout

```
package.json                  # workspaces: ["apps/*", "packages/*"]
pnpm-workspace.yaml
apps/
  web/                        # React + Vite frontend
    src/
      main.tsx
      App.tsx
      pages/
      components/
      lib/
        api.ts                # typed client → apps/api
  api/                        # Fastify backend (see api-service.md)
    src/
      server.ts
      routes/
      services/
      schemas/
packages/
  shared/                     # shared types, Zod schemas
    src/
      schemas/
      types.ts
.env.example
```

## Shared types

Schemas live in `packages/shared/src/schemas/` and are imported by both
`apps/web` (for client validation + types) and `apps/api` (for request validation).
This is the contract — there is no second source of truth.

```ts
// packages/shared/src/schemas/user.ts
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;
```

## API client

`apps/web/src/lib/api.ts` exposes typed functions. Don't sprinkle `fetch`
across components.

```ts
export const api = {
  users: {
    list: () => http.get<User[]>('/api/users'),
    get:  (id: string) => http.get<User>(`/api/users/${id}`),
    create: (body: CreateUserBody) => http.post<User>('/api/users', body),
  },
};
```

## Backend

Follows `api-service.md` patterns: Fastify, Zod validation, pino logs,
OpenAPI at `/docs`, env-only secrets, rate limiting, `/health` + `/ready`.

## Frontend

Follows `dashboard.md` patterns when there's a product UI, or
`landing-page.md` patterns for marketing-style pages. If both exist, see
`saas-app.md`.

## Dev experience

- `pnpm dev` runs `apps/web` + `apps/api` in parallel via `concurrently`
- Vite dev server proxies `/api/*` to the Fastify port
- TypeScript project references make `packages/shared` rebuild on save

## Environment

```
# .env.example
# Web (VITE_-prefixed are inlined into the client bundle)
VITE_API_URL=http://localhost:3000

# API
PORT=3000
DATABASE_URL=postgres://localhost:5432/app
JWT_SECRET=<min 32 chars>
LOG_LEVEL=info
```

## Security rules (hard, enforced)

- NEVER expose server secrets in `apps/web`. Only `VITE_`-prefixed env vars
  reach the browser bundle
- All API requests validated server-side regardless of client-side validation
- CORS on the API allowlists only the web origin
- Auth tokens stored in httpOnly cookies preferred over localStorage when feasible
- SQL via parameterized queries / ORM
- All cross-package types come from `packages/shared`; never duplicate schemas

## Quality rules

- TypeScript strict mode in every package
- ESLint + Prettier shared config in `packages/eslint-config`
- Frontend has loading / empty / error states on every async surface
- Backend has at least one test per route
- README explains how to run dev, test, build

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command`
Phase B' (humanizer): `humanize_doc` for any marketing copy in `apps/web`
Phase C (polish): `read_file`, `write_file`, `lint`, `typecheck`, `test`, `secret_scan`
