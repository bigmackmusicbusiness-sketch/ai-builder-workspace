# Security checklist — Dashboard

Dashboards display data — often privileged data like analytics, billing,
user lists, financials. They're high-value targets for both data exfiltration
and privilege escalation.

## Authorization is the ENTIRE feature
- [ ] Every widget queries data scoped to the viewer's role + tenant. Sharing filters across users is a data-leak speedrun.
- [ ] Role-based access control: viewer / member / admin / owner. Define exactly which widgets each role sees.
- [ ] Drill-down links validate access on click. A "View details" button must check ownership server-side, not just hide the row client-side.
- [ ] Aggregated metrics don't leak per-row data (don't compute "average revenue" from a query that returned 1 row).

## Chart / tooltip XSS
- [ ] Tooltip text from data sources renders through the framework's escape (`{value}`) — chart libraries with raw HTML tooltips (`html: true`, `useHTML: true`) are a XSS vector.
- [ ] User-uploaded chart titles, dataset names, custom legends — sanitize via DOMPurify or render as text.
- [ ] SVG generation libraries: don't pass user strings into `dangerouslySetInnerHTML` for SVG defs.

## CSV / Excel / PDF export
- [ ] CSV exports prefix cells starting with `=`, `+`, `-`, `@`, `|` with a single quote → prevents formula injection in Excel/Sheets.
- [ ] Generated PDFs sanitize user content before passing to the renderer (puppeteer/playwright HTML → PDF is the same XSS surface as a browser).
- [ ] Don't include the raw query in the export filename — `report-_DROP_TABLE.csv` saved by a victim is a problem.

## Filters / query params
- [ ] Filter values like `?status=open&user_id=123` are validated server-side. Don't rely on hidden UI state.
- [ ] PII in URL filters (`?email=foo@bar.com`) is bad — leaks to browser history, referrers, logs. Move to POST body.
- [ ] Date range filters: cap at sane maximums (e.g., 1 year) to prevent DoS on time-series tables.

## Real-time / websockets
- [ ] WebSocket auth: validate JWT on `connection` event, then on EVERY message — connections live for hours.
- [ ] Per-channel subscriptions enforce tenant scope. A subscriber to `tenant:123:metrics` must be a member of tenant 123.
- [ ] Rate-limit per-connection messages to prevent DoS via burst publish.

## Embedded iframes / shareable views
- [ ] If you offer a "share this dashboard publicly" feature, generate a signed token in the share URL. Tokens have scope (which widgets), expiry, and revocation.
- [ ] Embedded views set `X-Frame-Options: DENY` for the parent app and serve the embed from a SEPARATE origin to prevent click-jacking on the main UI.
- [ ] CSP for embed endpoints uses `frame-ancestors` allowlist matching customer domains.

## Caching
- [ ] Per-user cached responses keyed by user ID, not just URL. Otherwise user A's filter results show up for user B.
- [ ] CDN cache headers: `Cache-Control: private, no-store` for any user-scoped data.

## Headers
- [ ] Same as the SaaS checklist: HSTS, CSP, nosniff, frame-options, referrer-policy.
- [ ] `Permissions-Policy: geolocation=(), microphone=(), camera=()` — dashboards don't need these.
