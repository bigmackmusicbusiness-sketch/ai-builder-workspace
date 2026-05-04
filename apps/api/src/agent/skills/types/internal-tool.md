# Internal tool type SOP — runtime rules for executor + polish

This SOP applies to projects of type `internal-tool`. CRUD-shaped admin app
behind an auth gate, with role-based UI and an audit log.

## File layout

```
package.json
vite.config.ts
src/
  main.tsx
  App.tsx
  routes.tsx
  lib/
    api.ts
    auth.ts                # session + role helpers
    audit.ts               # logAuditEvent(actor, action, target)
  components/
    DataTable.tsx
    Drawer.tsx             # right-side detail panel
    FormField.tsx
    RoleGate.tsx           # <RoleGate roles={['admin']}>
    ConfirmDialog.tsx
  pages/
    Login.tsx
    <entity>/
      List.tsx             # filterable, paginated table
      Detail.tsx           # read-only header + tabs
      Edit.tsx             # form, validates client-side
    AuditLog.tsx           # read-only feed
    Settings.tsx
```

Stack: React 18 + Vite + TypeScript + Tailwind + react-hook-form + Zod for
validation.

## List → Detail → Form pattern

The default flow for any resource:

1. **List** — filterable, paginated table with row click → detail
2. **Detail** — read-only summary in a drawer or sub-route
3. **Edit** — opens from detail; submits via API; on success, returns to list
   with a success toast

Avoid in-place row editing. It's error-prone for internal users.

## Role-based UI

Roles come from the auth claim (e.g. `admin`, `editor`, `viewer`). Wrap
privileged controls:

```tsx
<RoleGate roles={['admin']}>
  <button onClick={onDelete}>Delete</button>
</RoleGate>
```

Server enforcement is mandatory regardless of UI gating. The UI gate is
ergonomic, not security.

## Audit log

Every mutating action calls `logAuditEvent`:

```ts
await logAuditEvent({
  actor: session.user.id,
  action: 'project.delete',
  target: projectId,
  metadata: { name: project.name },
});
```

The `audit_log` table is append-only (no update/delete policies). Surface it at
`/audit-log` with filters by actor, action, and date range.

## Confirm before destructive actions

Delete, archive, role-change, and bulk operations route through `<ConfirmDialog>`.
The dialog requires the user to type the resource name for irreversible deletes.

## Forms

- All forms use react-hook-form + Zod resolver
- Inline field errors next to each input
- Disabled submit until form is valid
- Optimistic UI only when the server response is fast and reversible

## Security rules (hard, enforced)

- Auth gate wraps every route except `/login`
- Role checks live on the server too — never trust the client gate alone
- All mutating endpoints require CSRF token or same-origin policy
- Audit log table is INSERT-only via RLS / DB grants
- NEVER expose service-role keys in the bundle (`VITE_` prefix only for safe vars)
- Soft-delete preferred over hard-delete; hard-delete is admin-only and audited
- Bulk actions cap at a configured row limit (default 500) to avoid runaway updates

## Quality rules

- TypeScript strict
- Loading / empty / error states on every async surface
- Tables persist filter + sort state in URL query params (sharable links)
- Keyboard shortcuts: `j`/`k` row nav, `e` edit, `?` help
- Toast notifications use a queue; never stack more than 3 visible

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`, `run_command`
Phase B' (humanizer): not applicable
Phase C (polish): `read_file`, `write_file`, `lint`, `typecheck`, `secret_scan`
