# API service type SOP — runtime rules for executor + polish

This SOP applies to projects of type `api-service`. Fastify REST API with Zod
validation, OpenAPI docs, auth middleware, rate limiting, structured logs.

## File layout

```
package.json
tsconfig.json
.env.example                  # placeholder values only
src/
  server.ts                   # bootstrap: app + listen
  app.ts                      # plugin registration, separated for testing
  config.ts                   # env parsing via Zod, throws on missing
  logger.ts                   # pino instance
  plugins/
    auth.ts                   # bearer / API-key middleware
    rateLimit.ts              # @fastify/rate-limit config
    cors.ts
    swagger.ts                # @fastify/swagger + swagger-ui at /docs
    errorHandler.ts           # standard error shape
  routes/
    health.ts                 # GET /health, /ready
    <resource>.ts             # one file per resource
  schemas/
    <resource>.schema.ts      # Zod request + response schemas
  services/
    <resource>.service.ts     # business logic, no HTTP types here
  db/
    client.ts                 # pg pool / prisma / drizzle
test/
  <route>.test.ts
```

Stack: Node 20+, Fastify 4, TypeScript strict, Zod, pino, Vitest.

## Bootstrap example

```ts
// src/server.ts
import { buildApp } from './app';
import { config } from './config';

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
```

## Config via Zod

```ts
const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export const config = ConfigSchema.parse(process.env);
```

The process exits at startup if any required env var is missing.

## Routes pattern

```ts
app.post('/users', {
  schema: {
    body: CreateUserBody,                  // Zod via fastify-type-provider-zod
    response: { 201: UserResponse, 400: ErrorResponse },
  },
  preHandler: [requireAuth, requireRole('admin')],
  handler: async (req, reply) => {
    const user = await usersService.create(req.body);
    return reply.code(201).send(user);
  },
});
```

Routes are thin: validate → auth → call service → respond.

## Standard error shape

```json
{
  "error": "ValidationError",
  "message": "email is required",
  "details": [{ "path": "email", "code": "required" }],
  "requestId": "req_01H..."
}
```

The `errorHandler` plugin maps thrown errors to this shape and logs with
`requestId` for tracing.

## Health + readiness

- `GET /health` — process liveness, returns 200 always while running
- `GET /ready` — checks DB and any required upstreams; 503 on degradation

## OpenAPI docs

`@fastify/swagger` + `swagger-ui` mount at `/docs`. Every route's Zod schemas
auto-publish. In production, gate `/docs` behind auth or disable via env flag.

## Rate limiting

Default: 100 req/min/IP global. Tighter limits on auth + write routes:

- `POST /auth/login` — 10/min/IP
- `POST /auth/forgot-password` — 5/min/IP
- Webhook receivers — per-source allowlist

## Logging (pino)

Structured logs only. Every request gets a `requestId`. Never log:

- Authorization headers
- Request bodies of auth routes (login, signup, password reset)
- Full PII (emails are fine; SSN/cards never)

## Security rules (hard, enforced)

- NEVER hardcode secrets. All credentials come from `process.env` parsed by config Zod schema
- `.env` files are gitignored; only `.env.example` is committed
- All inputs validated by Zod before reaching services
- Auth middleware runs before any non-public route
- CORS allowlist is explicit, never `*` for credentialed routes
- SQL goes through parameterized queries / ORM — never string concatenation
- Rate limiting on all public endpoints
- HTTPS-only in production (set `Strict-Transport-Security` header)
- Helmet (or @fastify/helmet) sets standard security headers
- No stack traces in production error responses

## Quality rules

- TypeScript strict mode
- Every route has at least one Vitest test
- Service layer has no Fastify imports (testable in isolation)
- Migrations versioned and replayable
- Graceful shutdown: SIGTERM → stop accepting → drain → close DB

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command`
Phase B' (humanizer): not applicable
Phase C (polish): `read_file`, `write_file`, `lint`, `typecheck`, `test`, `secret_scan`
