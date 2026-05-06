// apps/api/src/agent/security.ts — pre-write content scanner.
//
// Used at two points:
//   1. Before any write_file lands, scan content for hardcoded credentials.
//      If found, auto-strip + warn (or refuse for high-risk patterns).
//   2. By the polish phase, audit all written files for security issues.
//
// Per-type rules ride on top of the base credential scan: api-service rejects
// MORE patterns than website (e.g., raw DB connection strings); ebook rejects
// any <script> tag.

/** Regex patterns that indicate hardcoded credentials. Conservative — these
 *  match common provider key prefixes. False positives are acceptable; we'd
 *  rather strip a fake key than ship a real one.
 *
 *  Severity:
 *   - 'block' = refuse the write; force the agent to use an env var
 *   - 'strip' = replace with a [REDACTED-…] marker but proceed (used for
 *     publishable / non-secret keys that still shouldn't be inlined) */
export const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; provider: string; severity: 'block' | 'strip' }> = [
  // ── LLM / inference providers ─────────────────────────────────────────────
  { pattern: /sk-[A-Za-z0-9]{20,}/g,                  provider: 'OpenAI / Anthropic',     severity: 'block'  },
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g,           provider: 'OpenAI project key',     severity: 'block'  },
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,            provider: 'Anthropic',              severity: 'block'  },
  { pattern: /hf_[A-Za-z0-9]{30,}/g,                  provider: 'HuggingFace',            severity: 'block'  },
  { pattern: /r8_[A-Za-z0-9]{30,}/g,                  provider: 'Replicate',              severity: 'block'  },

  // ── Cloud hyperscalers ────────────────────────────────────────────────────
  { pattern: /AKIA[0-9A-Z]{16}/g,                     provider: 'AWS access key',         severity: 'block'  },
  { pattern: /ASIA[0-9A-Z]{16}/g,                     provider: 'AWS session token',      severity: 'block'  },
  { pattern: /DefaultEndpointsProtocol=https?;[^"'\n]*AccountKey=[A-Za-z0-9+/=]{20,}/g,
                                                       provider: 'Azure connection string', severity: 'block' },
  // GCP service-account JSON: detect when both type=service_account and a
  // PEM private_key appear within ~2 KB. Multi-key heuristic, intentionally
  // narrow to avoid matching benign JSON.
  { pattern: /"type"\s*:\s*"service_account"[\s\S]{0,2000}"private_key"\s*:\s*"-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
                                                       provider: 'GCP service account',   severity: 'block'  },

  // ── Payments ──────────────────────────────────────────────────────────────
  { pattern: /pk_live_[A-Za-z0-9]{20,}/g,             provider: 'Stripe live publishable', severity: 'strip' },
  { pattern: /sk_live_[A-Za-z0-9]{20,}/g,             provider: 'Stripe live secret',     severity: 'block'  },
  { pattern: /rk_live_[A-Za-z0-9]{20,}/g,             provider: 'Stripe restricted',      severity: 'block'  },
  { pattern: /whsec_[A-Za-z0-9]{20,}/g,               provider: 'Stripe webhook secret',  severity: 'block'  },

  // ── Comms / SaaS ──────────────────────────────────────────────────────────
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,         provider: 'Slack token',            severity: 'block'  },
  { pattern: /AC[a-f0-9]{32}/g,                       provider: 'Twilio account SID',     severity: 'strip'  },
  { pattern: /SK[a-f0-9]{32}/g,                       provider: 'Twilio API key SID',     severity: 'block'  },
  { pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
                                                       provider: 'SendGrid API key',      severity: 'block'  },
  { pattern: /key-[a-f0-9]{32}/g,                     provider: 'Mailgun API key',        severity: 'block'  },

  // ── Source control / hosting ──────────────────────────────────────────────
  { pattern: /ghp_[A-Za-z0-9]{36}/g,                  provider: 'GitHub PAT',             severity: 'block'  },
  { pattern: /gho_[A-Za-z0-9]{36}/g,                  provider: 'GitHub OAuth token',     severity: 'block'  },
  { pattern: /github_pat_[A-Za-z0-9_]{50,}/g,         provider: 'GitHub fine-grained PAT', severity: 'block' },
  { pattern: /glpat-[A-Za-z0-9_-]{20,}/g,             provider: 'GitLab PAT',             severity: 'block'  },
  { pattern: /dop_v1_[a-f0-9]{64}/g,                  provider: 'DigitalOcean PAT',       severity: 'block'  },

  // ── Google ────────────────────────────────────────────────────────────────
  { pattern: /ya29\.[A-Za-z0-9_-]{20,}/g,             provider: 'Google OAuth',           severity: 'block'  },
  { pattern: /AIza[0-9A-Za-z_-]{35}/g,                provider: 'Google API key',         severity: 'block'  },

  // ── Generic JWT (catch-all, lower confidence) ────────────────────────────
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
                                                       provider: 'JWT-shaped token',      severity: 'strip'  },

  // ── Private keys ──────────────────────────────────────────────────────────
  { pattern: /-----BEGIN (?:OPENSSH|RSA|EC|DSA|PGP)?\s?PRIVATE KEY(?:\s?BLOCK)?-----/g,
                                                       provider: 'Private key block',     severity: 'block'  },

  // ── Connection strings with embedded passwords ────────────────────────────
  // jdbc:mysql://user:password@host/db or postgres://user:password@host/db
  { pattern: /jdbc:[a-z]+:\/\/[^"'\s]+:[^"'\s@]{4,}@/g, provider: 'JDBC URL with password', severity: 'block' },
  { pattern: /postgres(?:ql)?:\/\/[^"'\s:@]+:[^"'\s@]{4,}@[^"'\s/]+/g,
                                                       provider: 'Postgres URL with password', severity: 'block' },
  { pattern: /mongodb(?:\+srv)?:\/\/[^"'\s:@]+:[^"'\s@]{4,}@[^"'\s/]+/g,
                                                       provider: 'MongoDB URL with password',  severity: 'block' },
];

export interface SecurityFinding {
  pattern:    string;
  provider:   string;
  severity:   'block' | 'strip';
  /** First few characters of the matched value, for log diagnostics. */
  preview:    string;
}

/** Scan a piece of file content for credentials. Returns findings; does not
 *  modify the content. Caller decides whether to block, strip, or proceed. */
export function scanForCredentials(content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { pattern, provider, severity } of CREDENTIAL_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches) {
        findings.push({
          pattern:  pattern.source,
          provider,
          severity,
          preview:  match.slice(0, 8) + '…',
        });
      }
    }
  }
  return findings;
}

/** Strip findings of severity 'strip' from content, leaving a comment marker. */
export function stripCredentials(content: string, findings: SecurityFinding[]): string {
  let result = content;
  for (const { pattern, provider, severity } of findings) {
    if (severity !== 'strip') continue;
    result = result.replace(new RegExp(pattern, 'g'), `[REDACTED-${provider.toUpperCase().replace(/\s+/g, '_')}]`);
  }
  return result;
}

/** Check for known-bad inline patterns (XSS surfaces, missing CSRF, etc.).
 *  Used by the polish phase to surface findings on every written HTML/JSX/TSX. */
export interface RiskyPatternFinding {
  category:
    | 'xss'                  // generic dangerous-API usage (eval, innerHTML, etc.)
    | 'unsafe-iframe'        // iframe from non-allowlisted domain
    | 'unsafe-target-blank'  // <a target="_blank"> without rel="noopener"
    | 'missing-csrf'         // <form method=POST> with no csrf token / origin guard
    | 'missing-sri'          // <script src="cdn..."> with no integrity attr
    | 'unsafe-script';       // inline <script> with dangerous APIs
  message:   string;
  line?:     number;
}

export function scanForRiskyHtml(content: string): RiskyPatternFinding[] {
  const findings: RiskyPatternFinding[] = [];

  // ── target="_blank" without rel="noopener noreferrer" ─────────────────────
  const blankLinkPattern = /<a[^>]+target=["']_blank["'][^>]*>/gi;
  for (const match of content.matchAll(blankLinkPattern)) {
    const tag = match[0] ?? '';
    if (!/rel=["'][^"']*noopener/i.test(tag)) {
      findings.push({
        category: 'unsafe-target-blank',
        message:  `<a target="_blank"> missing rel="noopener noreferrer"`,
      });
    }
  }

  // ── <iframe src="..."> from non-allowlisted domains ───────────────────────
  const iframePattern = /<iframe[^>]*src=["']([^"']+)["']/gi;
  for (const match of content.matchAll(iframePattern)) {
    const src = match[1] ?? '';
    if (!src) continue;
    if (!/^(https?:\/\/(www\.)?(youtube|vimeo|google\.com\/maps|maps\.google|spotify|soundcloud)\.)/i.test(src)) {
      findings.push({
        category: 'unsafe-iframe',
        message:  `<iframe src="${src.slice(0, 50)}…"> from non-allowlisted domain`,
      });
    }
  }

  // ── <form method=POST> without CSRF token / origin guard ──────────────────
  // Heuristic: look for <form> tags whose method is POST (or PUT/PATCH/DELETE
  // emulated via _method input) and which DON'T contain a hidden csrf input
  // OR a data-csrf attribute. We scan the whole tag block (open → close) so
  // a long form with a token nested inside still passes.
  const formPattern = /<form\b[^>]*method=["']?(post|put|patch|delete)["']?[^>]*>([\s\S]*?)<\/form>/gi;
  for (const match of content.matchAll(formPattern)) {
    const block = match[0] ?? '';
    const hasCsrfInput = /<input\b[^>]*name=["'](?:_csrf|csrf|csrf_token|csrfmiddlewaretoken|authenticity_token)["']/i.test(block);
    const hasCsrfAttr  = /data-csrf=/i.test(block);
    const hasJsHandler = /\bonsubmit=/i.test(block); // assume JS handler attaches token
    if (!hasCsrfInput && !hasCsrfAttr && !hasJsHandler) {
      findings.push({
        category: 'missing-csrf',
        message:  `<form method="${match[1]?.toUpperCase()}"> has no CSRF token input or data-csrf attribute`,
      });
    }
  }

  // ── External <script src> without subresource integrity ───────────────────
  const externalScriptPattern = /<script\b[^>]*src=["']https?:\/\/[^"']+["'][^>]*>/gi;
  for (const match of content.matchAll(externalScriptPattern)) {
    const tag = match[0] ?? '';
    if (!/integrity=/i.test(tag)) {
      // Skip well-known utility CDNs that typically serve sites in dev — flag
      // them as 'missing-sri' anyway so the user can decide. The flag is
      // informational; polish doesn't auto-add SRI.
      const srcMatch = tag.match(/src=["']([^"']+)["']/i);
      const src = srcMatch?.[1] ?? '';
      findings.push({
        category: 'missing-sri',
        message:  `<script src="${src.slice(0, 60)}…"> lacks integrity= (SRI) attribute`,
      });
    }
  }

  // ── Inline <script> with dangerous JS APIs ────────────────────────────────
  // We only flag inline scripts (no src=) because external scripts get the
  // SRI flag above. False positives here are acceptable; the agent should
  // avoid string-arg setTimeout/setInterval/eval/Function regardless.
  const inlineScriptPattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of content.matchAll(inlineScriptPattern)) {
    const body = match[1] ?? '';
    if (/\beval\s*\(/.test(body)) {
      findings.push({ category: 'unsafe-script', message: 'inline <script> uses eval()' });
    }
    if (/\bnew\s+Function\s*\(/.test(body)) {
      findings.push({ category: 'unsafe-script', message: 'inline <script> uses new Function()' });
    }
    if (/\b(?:setTimeout|setInterval)\s*\(\s*["'`]/.test(body)) {
      findings.push({ category: 'unsafe-script', message: 'inline <script> calls setTimeout/setInterval with a string argument (eval-equivalent)' });
    }
  }

  // ── DOM XSS sinks anywhere in the file (covers JSX/TSX too) ──────────────
  if (/dangerouslySetInnerHTML/.test(content)) {
    findings.push({
      category: 'xss',
      message:  'dangerouslySetInnerHTML used — sanitize the value (DOMPurify) or render with {value} instead',
    });
  }
  if (/\.innerHTML\s*=/.test(content)) {
    findings.push({
      category: 'xss',
      message:  '.innerHTML = assignment — prefer textContent or a sanitized DOM construction',
    });
  }
  if (/\bdocument\.write\s*\(/.test(content)) {
    findings.push({
      category: 'xss',
      message:  'document.write() can enable XSS; use DOM APIs instead',
    });
  }

  return findings;
}
