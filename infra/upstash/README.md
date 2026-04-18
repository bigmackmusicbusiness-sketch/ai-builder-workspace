# Upstash

Two services are used:

- **Redis (REST)** — agent step queue buffer, per-run state cache, rate-limit counters.
- **QStash** — durable cron, retries, webhook replay buffer.

## Required env

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
UPSTASH_QSTASH_TOKEN=
```

## Operational notes

- All access is server-side only (`/api`). Never expose tokens to the browser.
- QStash signing keys must be verified on every inbound webhook; keep keys in the vault.
- Queue payloads must never contain decrypted secrets — pass opaque handles instead.
