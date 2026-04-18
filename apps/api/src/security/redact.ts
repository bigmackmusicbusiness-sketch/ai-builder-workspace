// apps/api/src/security/redact.ts — redact secrets from log output and strings.
// Every logger and all runtime_logs writes pass through redact() first.

/** Patterns that identify likely secret material. Keep in sync with scripts/secret-scan.mjs */
const SECRET_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk_live_[A-Za-z0-9]{24,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /-----BEGIN [A-Z ]+KEY-----[\s\S]*?-----END [A-Z ]+KEY-----/g,
  /postgres(?:ql)?:\/\/[^\s'"]*:[^\s'"@]+@[^\s'"]+/g,
];

const REDACT_MARKER = '[REDACTED]';

export function redactString(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACT_MARKER);
  }
  return out;
}

export function redactObject<T>(obj: T): T {
  if (typeof obj === 'string') return redactString(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(redactObject) as unknown as T;
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      // Always redact values of sensitive key names regardless of content.
      const lk = k.toLowerCase();
      const isSensitiveKey =
        lk.includes('secret') || lk.includes('token') || lk.includes('key') ||
        lk.includes('password') || lk.includes('credential') || lk.includes('ciphertext') ||
        lk.includes('nonce') || lk.includes('signing') || lk.includes('private');
      out[k] = isSensitiveKey ? REDACT_MARKER : redactObject(v);
    }
    return out as T;
  }
  return obj;
}
