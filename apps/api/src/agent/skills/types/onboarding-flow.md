# Onboarding flow type SOP — runtime rules for executor + polish

This SOP applies to projects of type `onboarding-flow`. Multi-step typed
wizard with progress, save-and-resume, approval gates, and rollback.

## File layout

```
package.json
src/
  main.tsx
  App.tsx
  flow/
    steps.ts               # StepDef[] — the source of truth
    state.ts               # Zustand or context store, persisted
    schema.ts              # Zod schemas per step
  components/
    Wizard.tsx             # shell: progress bar + current step + nav
    StepShell.tsx          # title, body slot, back/next, validation
    ProgressBar.tsx
    ApprovalGate.tsx
    ReviewStep.tsx         # final summary before submit
  steps/                   # one component per step
    Welcome.tsx
    Profile.tsx
    Preferences.tsx
    Verify.tsx
    Done.tsx
```

## StepDef shape

```ts
export type StepDef<T = unknown> = {
  id: string;
  title: string;
  schema: z.ZodSchema<T>;
  component: React.FC<StepProps<T>>;
  requiresApproval?: boolean;     // pause for human/email confirm
  canSkip?: boolean;
  rollback?: (state: FlowState) => Promise<void>;
};

export const STEPS: StepDef[] = [
  { id: 'welcome', title: 'Welcome', schema: z.object({}), component: Welcome },
  { id: 'profile', title: 'Your profile', schema: ProfileSchema, component: Profile },
  { id: 'verify',  title: 'Verify email', schema: z.object({ token: z.string() }),
    component: Verify, requiresApproval: true },
  { id: 'done',    title: 'All set',     schema: z.object({}), component: Done },
];
```

The wizard is driven entirely by `STEPS`. Adding a step = adding an entry.

## Progress + nav

- Progress bar shows `currentIndex / total` with the current step title
- Back returns to the previous step preserving its data
- Next runs the current step's Zod parse; on failure, shows inline errors
- Submit button only appears on the final review step

## Save and resume

State is persisted to `localStorage` under a versioned key (`onboarding:v1:state`)
on every step transition. On mount, the wizard restores progress and routes the
user back to the last incomplete step.

If schema or step list changes between versions, bump the version key and
discard old state (don't try to migrate partial data automatically).

## Approval gates

Steps marked `requiresApproval: true` block forward progress until an external
event clears the gate (email link clicked, manager approved in another system,
etc.). The UI shows a holding state with a "Resend" action and a polling loop
or webhook listener.

```tsx
<ApprovalGate
  pollUrl="/api/onboarding/verify-status"
  intervalMs={5000}
  onApproved={() => goNext()}
/>
```

## Rollback

If the user abandons or the flow errors irrecoverably, the wizard runs each
completed step's `rollback` in reverse order. Rollback is best-effort and idempotent.
Common rollbacks: revoke partial OAuth grants, delete draft records, cancel
verification tokens.

## Copy / voice rules

- Step titles are short noun phrases ("Your profile", not "Tell us about you")
- Body copy is encouraging and concrete ("This takes about 2 minutes")
- Error messages name the field and the fix ("Email needs an @ symbol")
- Final review step labels every entered value in plain language

## Security rules (hard, enforced)

- Sensitive fields (SSN, full DOB, government IDs) NEVER persisted to localStorage
- Approval-gated steps verify token server-side, not client-side
- PII is sent only to the configured backend, never to analytics
- Tokens used for verification expire and are single-use
- Rollback handlers run with appropriate auth; never grant elevated privileges to roll back
- CSRF token required on all mutating step submissions

## Quality rules

- Each step is independently testable (component + schema)
- Browser back button mirrors the wizard's back nav
- ESC closes any modal but does not skip a step
- Final submit is idempotent (same payload + idempotency key = same result)
- Loading + empty + error states on every async step

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command`
Phase B' (humanizer): `humanize_doc` for step copy
Phase C (polish): `read_file`, `write_file`, `lint`, `typecheck`
