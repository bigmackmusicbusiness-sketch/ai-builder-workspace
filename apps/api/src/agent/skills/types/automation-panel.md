# Automation panel type SOP — runtime rules for executor + polish

This SOP applies to projects of type `automation-panel`. UI for triggering,
queuing, and observing background tasks/workflows. Includes webhook receivers.

## File layout

```
apps/web/                       # control panel (React + Vite)
  src/
    pages/
      Workflows.tsx             # list + create
      WorkflowDetail.tsx        # config + recent runs
      Runs.tsx                  # global run history with filters
      RunDetail.tsx             # logs, inputs, outputs, retry
      Triggers.tsx              # cron + webhook config
    components/
      QueueDepth.tsx            # live count by status
      StatusDot.tsx             # green / amber / red / grey
      RunRow.tsx
      RetryButton.tsx
      LogViewer.tsx             # tails logs from API
    lib/
      api.ts
      ws.ts                     # websocket / SSE client for live updates
apps/api/                       # task runner + webhook receiver (Fastify)
  src/
    server.ts
    queue.ts                    # BullMQ or pg-boss wrapper
    workflows/<id>.ts           # one file per workflow definition
    webhooks/<source>.ts        # one route per webhook source
    routes/runs.ts
    routes/triggers.ts
```

## Status model

A run is always in one of: `queued`, `running`, `succeeded`, `failed`,
`cancelled`, `retrying`. The `StatusDot` colors are:

- `queued` — grey
- `running` — blue (animated pulse)
- `succeeded` — green
- `failed` — red
- `cancelled` — amber
- `retrying` — amber (animated)

## Retry logic

Default policy: exponential backoff, max 5 attempts, jitter ±20%. Each retry
is a new run row linked to the parent. The user can:

- Manually retry a failed run (creates a new run referencing the original input)
- Cancel a queued or running run
- Replay a run with edited inputs (creates a fresh run; original preserved)

Idempotency keys are required on side-effecting steps. The runner stores
`(workflow, idempotency_key) → run_id` to dedupe.

## Triggers

Three trigger kinds:

- **Manual** — button in UI, optional input form
- **Cron** — UTC cron expression validated server-side
- **Webhook** — `POST /webhooks/<source>` with HMAC signature verification

Webhook handler template:

```ts
app.post('/webhooks/stripe', async (req, reply) => {
  const sig = req.headers['stripe-signature'];
  const event = verifyStripeSignature(req.rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  await queue.add('stripe.event', event, { jobId: event.id }); // idempotent
  return reply.code(202).send({ received: true });
});
```

Always: verify signature → enqueue with idempotent jobId → 2xx fast. Never
process synchronously inside the webhook handler.

## Live updates

The Runs and RunDetail pages subscribe to a websocket or SSE stream for status
changes. Fall back to polling every 5s if the connection drops.

## Logs

Logs are streamed line-by-line and chunked by run. The `LogViewer` shows:

- Auto-scroll on (toggleable)
- Filter by level (info / warn / error)
- Download as `.log`

Sensitive values (api keys, tokens) are redacted server-side before streaming.

## Security rules (hard, enforced)

- Webhook handlers MUST verify signatures before reading the body for app logic
- Webhook secrets live in env vars only, never hardcoded
- Run inputs displayed in UI must redact known secret patterns
- Workflow definitions cannot execute arbitrary user-supplied code (no `eval`,
  no `new Function`); they call typed task handlers by name
- Manual triggers require auth + role check on the API
- Replay-with-edited-inputs is logged in the audit trail
- Rate limit webhook endpoints per source (default: 100 req/min/IP)

## Quality rules

- Every run row links to a detail page with full context
- Failed runs surface the error message + line, not just "Failed"
- Queue depth banner appears when depth > threshold (default 100)
- Empty states explain how to create the first workflow / connect a webhook

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command`
Phase B' (humanizer): not applicable
Phase C (polish): `read_file`, `write_file`, `lint`, `typecheck`, `secret_scan`
