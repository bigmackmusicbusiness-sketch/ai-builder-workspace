# Secrets & Vault — operator reference

> Single source of truth for "how do API keys actually resolve in this app
> and how do I give a new user access to them." If you're operating ABW
> as the human-in-the-loop, start here.

## TL;DR

This is an **internal app** (≤10 lifetime users). API keys (MiniMax,
Replicate, OpenAI, Coolify creds, etc.) are stored **per tenant** in
the encrypted `secret_metadata` + `secret_values` tables. Every tenant
needs its own row. The vault is the source of truth in normal
operation.

There's also a **dormant platform-key env-var fallback** in
`apps/api/src/security/vault.ts::vaultGetOrEnv` that activates only if
both (a) the operator sets a Coolify env var and (b) the tenant's
vault doesn't have the key. Today it never fires — the model is direct
per-tenant grants. Fallback is wired up just in case the model shifts
later (e.g. to a Coolify-managed central key store).

## When to use what

| Situation | Action |
|---|---|
| New user signs up | Their tenant has 0 secrets. Run `grant-secrets-to-sps-admin.ts` adapted for that tenant (or extend the script to take `--target-email`). |
| Cross-tenant ABW use (SPS proxy, system tenant, etc.) | Use the grant script. Doesn't need any Coolify changes. |
| Operator rotates a provider key | Update the row via the IDE's Env & Secrets screen (writes to vault under the signed-in user's tenant). Then re-run the grant script to propagate to other tenants. |
| Migrate to Coolify-managed central keys (future) | Set the env var on Coolify; the `vaultGetOrEnv` fallback in providers will pick it up. The vault entries can stay or be deleted — vault wins first, fallback only fires on miss. |

## Cross-tenant secret grant — the script

**File:** `apps/api/scripts/grant-secrets-to-sps-admin.ts`

**What it does:** Finds the SignalPoint Admin account via Supabase
admin listUsers, picks the source tenant by max secret count
(operator's own tenant), and inserts a duplicate metadata + values row
in the dest tenant for each (name, env) pair the dest doesn't already
have. Same ciphertext is shared — `VAULT_MASTER_KEY` is server-wide,
so decryption works regardless of which tenant_id the metadata sits
under.

**Usage:**

```bash
# Preview only (recommended first run)
DRY_RUN=1 pnpm tsx apps/api/scripts/grant-secrets-to-sps-admin.ts

# Apply
pnpm tsx apps/api/scripts/grant-secrets-to-sps-admin.ts
```

**Requires** (in `apps/api/.env` or shell env):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — to look up the SignalPoint Admin user
- `DATABASE_URL` — to read + write secret_metadata + secret_values

**Idempotent.** Re-running is safe; rows that already exist in the
dest tenant are skipped (logged, no duplicate, no exception).

**Never logs secret values.** Only counts + names. Output is safe to
share.

## The dormant platform-key fallback (vaultGetOrEnv)

**File:** `apps/api/src/security/vault.ts`

**Function:** `vaultGetOrEnv({ names, env, tenantId })`

**Behavior:** Tries the vault first for each candidate name, then
falls back to `process.env[name]` for each. Returns null if neither
yields a value.

**Where it's used:** Inside the per-provider key resolvers — see
`providers/minimax.ts`, `providers/openai.ts`, `providers/replicate.ts`,
`routes/music.ts`, `routes/ai-edit.ts`, `agent/tools.ts`,
`publish/coolifyApi.ts`. Each provider passes its own `KEY_NAMES`
array. The vault check preserves any per-tenant override.

**Why it exists today:** Shipped in commit `2d3b1e9` (2026-05-14) as
part of the round 14.3 SPS-Bookstore unblock, then deemed overkill for
the <10-user model and replaced with the direct-grant approach above.
The code stayed in as a dormant safety net — zero risk because no
Coolify env vars are set, so the fallback never fires.

**When this might matter:** If someone (operator or future agent)
ever wants to centralize keys at the Coolify level — set
`MINIMAX_API_KEY` (etc.) as a Coolify env var on the api app, and the
fallback picks it up immediately. No code change needed, no restart
beyond the normal env-var apply.

**Providers that are intentionally NOT using the fallback:**

- `providers/higgsfield.ts` — OAuth tokens are genuinely per-tenant
  (each user has their own connection)
- `agent/tools/integration.invoke.ts` — tenant-installed integrations

## Tenant ID quick reference

These are the well-known tenants in production:

| Tenant | ID | Email / kind |
|---|---|---|
| Operator (Melvin) | `5ca74590-6f99-4a7e-82b9-ca2c53a79253` | Operator's own tenant — populated via IDE Env & Secrets |
| SignalPoint Admin (SPS proxy) | `e7237058-0550-4655-be90-28c80685aad5` | Synthetic system user (`sps-handoff-proxy@signalpoint.test`); env var `SPS_SYSTEM_TENANT_ID` resolves to this |
| Noah | not stored here — Noah lives in operator's tenant | Operator gave Noah access via standard auth flow; secrets are tenant-shared |

If you forget which tenant has which secrets, dry-run the grant
script — it prints a "Source tenant candidates" table showing the top
5 tenants by secret count.

## When to update this doc

- A new provider added to the codebase that uses the vault → add to the
  "intentionally NOT using the fallback" list (if appropriate) or
  flag for migration to `vaultGetOrEnv`
- A new system-tenant added (e.g. another integration with its own
  synthetic user) → add to the tenant table above
- The platform-key fallback gets activated (Coolify env vars set) →
  update the "Why it exists today" section and add operator runbook
- The grant script gets extended to take `--target-email` → update the
  usage examples
