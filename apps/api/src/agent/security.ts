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
 *  rather strip a fake key than ship a real one. */
export const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; provider: string; severity: 'block' | 'strip' }> = [
  { pattern: /sk-[A-Za-z0-9]{20,}/g,                provider: 'OpenAI / Anthropic', severity: 'block'  },
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g,         provider: 'OpenAI project key',  severity: 'block'  },
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,          provider: 'Anthropic',           severity: 'block'  },
  { pattern: /AKIA[0-9A-Z]{16}/g,                    provider: 'AWS access key',      severity: 'block'  },
  { pattern: /pk_live_[A-Za-z0-9]{20,}/g,            provider: 'Stripe live publishable', severity: 'strip' },
  { pattern: /sk_live_[A-Za-z0-9]{20,}/g,            provider: 'Stripe live secret',  severity: 'block'  },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,        provider: 'Slack token',         severity: 'block'  },
  { pattern: /ghp_[A-Za-z0-9]{36}/g,                 provider: 'GitHub PAT',          severity: 'block'  },
  { pattern: /ya29\.[A-Za-z0-9_-]{20,}/g,            provider: 'Google OAuth',        severity: 'block'  },
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, provider: 'JWT-shaped token', severity: 'strip' },
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

/** Check for known-bad inline patterns (XSS surfaces, etc.). */
export interface RiskyPatternFinding {
  category:  'xss' | 'unsafe-iframe' | 'unsafe-target-blank';
  message:   string;
  line?:     number;
}

export function scanForRiskyHtml(content: string): RiskyPatternFinding[] {
  const findings: RiskyPatternFinding[] = [];

  // target="_blank" without rel="noopener noreferrer"
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

  // <iframe src="..."> from untrusted domains is risky; flag any iframe for
  // human review (we don't allowlist domains here).
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

  return findings;
}
