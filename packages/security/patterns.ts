// packages/security/patterns.ts — secret scan patterns (gitleaks-style regexes).
// Used by the secretScan verify adapter and any pre-commit hooks.
// Never add actual secret values here — only detection patterns.

export interface SecretPattern {
  id:          string;
  description: string;
  regex:       RegExp;
  /** Lower-case keywords that, if present in the same line, reduce false-positive rate */
  keywords?:   string[];
  /** Lines containing these strings are ignored (test fixtures, docs, etc.) */
  ignoreIf?:   string[];
}

// ── Built-in patterns ─────────────────────────────────────────────────────────

export const SECRET_PATTERNS: SecretPattern[] = [
  // Generic high-entropy assignment (long hex/base64)
  {
    id:          'generic-api-key',
    description: 'Generic API key assignment',
    regex:       /(?:api[_\-.]?key|apikey|api[_\-.]?token|access[_\-.]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{20,}['"]?/i,
    keywords:    ['key', 'token'],
    ignoreIf:    ['example', 'placeholder', 'your_key_here', '<your', 'REPLACE', 'CHANGE_ME'],
  },
  // AWS access key
  {
    id:          'aws-access-key',
    description: 'AWS access key ID',
    regex:       /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/,
  },
  // AWS secret key
  {
    id:          'aws-secret-key',
    description: 'AWS secret access key',
    regex:       /aws[_\-.]?secret[_\-.]?(?:access[_\-.]?)?key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i,
  },
  // GitHub tokens
  {
    id:          'github-token',
    description: 'GitHub personal access token',
    regex:       /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,
  },
  // Stripe keys
  {
    id:          'stripe-key',
    description: 'Stripe API key',
    regex:       /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/,
  },
  // Supabase service-role key (JWT with long body)
  {
    id:          'supabase-service-role',
    description: 'Supabase service role key (JWT)',
    regex:       /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{43}/,
    ignoreIf:    ['anon', 'SUPABASE_ANON'],
  },
  // Vault master key (base64-encoded 32 bytes)
  {
    id:          'vault-master-key',
    description: 'Vault master key reference',
    regex:       /VAULT_MASTER_KEY\s*[:=]\s*['"]?[A-Za-z0-9+/]{43}={0,2}['"]?/,
    ignoreIf:    ['example', '.env.example'],
  },
  // Cloudflare API token
  {
    id:          'cf-api-token',
    description: 'Cloudflare API token',
    regex:       /CF_API_TOKEN\s*[:=]\s*['"]?[A-Za-z0-9_-]{37,}['"]?/,
    ignoreIf:    ['example'],
  },
  // Generic "password" assignment
  {
    id:          'password-assignment',
    description: 'Hardcoded password',
    regex:       /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    ignoreIf:    ['example', 'test', 'placeholder', 'changeme', 'your_password', '<password'],
  },
  // Private key PEM block
  {
    id:          'private-key-pem',
    description: 'PEM private key block',
    regex:       /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  // MiniMax API key pattern
  {
    id:          'minimax-api-key',
    description: 'MiniMax API key',
    regex:       /MINIMAX_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}['"]?/,
    ignoreIf:    ['example'],
  },
  // Upstash tokens
  {
    id:          'upstash-token',
    description: 'Upstash REST token',
    regex:       /UPSTASH_(?:REDIS_REST_TOKEN|QSTASH_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9_-]{30,}['"]?/,
    ignoreIf:    ['example'],
  },
];

// ── File path ignore list ─────────────────────────────────────────────────────

/** File paths that are always excluded from secret scanning */
export const IGNORE_PATHS: RegExp[] = [
  /\.env\.example$/,
  /\.env\.local\.example$/,
  /\.git\//,
  /node_modules\//,
  /dist\//,
  /build\//,
  /\.turbo\//,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /\.snap$/,           // vitest snapshots
  /HANDOFF_NOTES\.md$/,
  /README\.md$/i,
];

// ── Scanner utility ───────────────────────────────────────────────────────────

export interface ScanFinding {
  patternId:   string;
  description: string;
  file:        string;
  line:        number;
  match:       string;  // redacted — first 8 chars + …
}

/** Scan a single file's lines against all patterns. */
export function scanLines(filePath: string, lines: string[]): ScanFinding[] {
  // Skip ignored paths
  if (IGNORE_PATHS.some((re) => re.test(filePath))) return [];

  const findings: ScanFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.ignoreIf?.some((s) => line.toLowerCase().includes(s.toLowerCase()))) {
        continue;
      }

      if (pattern.regex.test(line)) {
        const match = line.match(pattern.regex)?.[0] ?? '';
        findings.push({
          patternId:   pattern.id,
          description: pattern.description,
          file:        filePath,
          line:        i + 1,
          // Redact: only expose first 8 chars
          match:       match.length > 8 ? `${match.slice(0, 8)}…` : '[redacted]',
        });
      }
    }
  }

  return findings;
}
