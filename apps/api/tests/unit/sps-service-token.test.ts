// apps/api/tests/unit/sps-service-token.test.ts
//
// Locks in the ABW→SPS S2S minter shape per round-6 INBOUND. SPS rejects
// drift with specific reason codes (wrong_issuer, wrong_audience,
// wrong_scope, lifetime_too_long, etc.) — better to catch any of those
// here than at first publish.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.SUPABASE_URL              ??= 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY         ??= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  process.env.SUPABASE_JWT_SECRET       ??= 'test-jwt-secret';
  process.env.VAULT_MASTER_KEY          ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
});

import { createHmac } from 'node:crypto';
import {
  ASSIGN_NEW_CUSTOMER_SCOPE,
  MINT_SITE_CONFIG_SCOPE,
  SpsServiceTokenError,
  mintAbwS2sToken,
} from '../../src/security/spsServiceToken';

const WS = '11111111-2222-3333-4444-555555555555';
// 32-byte test key, base64-encoded (matches resolveKey's >= 32-byte gate).
const TEST_KEY_RAW = Buffer.alloc(32, 0x42); // 32 'B' bytes
const TEST_KEY_B64 = TEST_KEY_RAW.toString('base64');

beforeEach(() => {
  process.env.SPS_HANDOFF_KID_DEFAULT = 'k1';
  process.env.SPS_HANDOFF_KEY_K1      = TEST_KEY_B64;
});

afterEach(() => {
  delete process.env.SPS_HANDOFF_KID_DEFAULT;
  delete process.env.SPS_HANDOFF_KEY_K1;
});

function decodeB64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

describe('mintAbwS2sToken — payload shape (round 6 contract)', () => {
  it('produces a 3-part compact JWT', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS });
    expect(tok.split('.').length).toBe(3);
  });

  it('header has alg=HS256, typ=JWT, kid from env', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS });
    const [headerB64] = tok.split('.');
    const header = JSON.parse(decodeB64Url(headerB64));
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe('k1');
  });

  it('payload locks in iss=abw, aud=sps, scope=mint-site-config', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.iss).toBe('abw');
    expect(payload.aud).toBe('sps');
    expect(payload.scope).toBe('mint-site-config');
  });

  it('payload echoes spsWorkspaceId lowercased', () => {
    const upper = '11111111-2222-3333-4444-555555555555'.toUpperCase();
    const tok = mintAbwS2sToken({ spsWorkspaceId: upper });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.sps_workspace_id).toBe(upper.toLowerCase());
  });

  it('default lifetime is 60s; iat <= now <= exp; exp = iat + lifetime', () => {
    const fixedNow = 1_770_000_000_000; // ms
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS, now: () => fixedNow });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.iat).toBe(Math.floor(fixedNow / 1000));
    expect(payload.exp).toBe(payload.iat + 60);
  });

  it('respects custom lifetimeSec', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS, lifetimeSec: 120, now: () => 1_770_000_000_000 });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.exp - payload.iat).toBe(120);
  });

  it('signature verifies under the configured shared secret', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS });
    const [headerB64, payloadB64, sigB64] = tok.split('.');
    const expected = createHmac('sha256', TEST_KEY_RAW)
      .update(`${headerB64}.${payloadB64}`)
      .digest()
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(sigB64).toBe(expected);
  });
});

describe('mintAbwS2sToken — input validation', () => {
  it('rejects non-UUID spsWorkspaceId', () => {
    expect(() => mintAbwS2sToken({ spsWorkspaceId: 'not-a-uuid' })).toThrow(/not a UUID/);
  });

  it('rejects spsWorkspaceId of wrong length', () => {
    expect(() => mintAbwS2sToken({ spsWorkspaceId: '11111111-2222-3333-4444' })).toThrow(SpsServiceTokenError);
  });

  it('rejects lifetime > 300s (SPS cap)', () => {
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS, lifetimeSec: 301 }))
      .toThrow(/exceeds SPS cap of 300s/);
  });

  it('rejects 0 / negative / non-finite lifetime', () => {
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS, lifetimeSec: 0 })).toThrow(/positive finite/);
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS, lifetimeSec: -1 })).toThrow(/positive finite/);
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS, lifetimeSec: Number.POSITIVE_INFINITY })).toThrow(/positive finite/);
  });
});

describe('mintAbwS2sToken — env config errors', () => {
  it('throws when SPS_HANDOFF_KID_DEFAULT is missing', () => {
    delete process.env.SPS_HANDOFF_KID_DEFAULT;
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS })).toThrow(/SPS_HANDOFF_KID_DEFAULT not set/);
  });

  it('throws when SPS_HANDOFF_KEY_<KID> is missing', () => {
    delete process.env.SPS_HANDOFF_KEY_K1;
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS })).toThrow(/SPS_HANDOFF_KEY_K1 not set/);
  });

  it('throws when key is too short (< 32 bytes after b64 decode)', () => {
    process.env.SPS_HANDOFF_KEY_K1 = Buffer.alloc(16, 0x42).toString('base64');
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS })).toThrow(/below 32 bytes/);
  });

  it('throws when kid contains chars outside [a-zA-Z0-9_-]', () => {
    process.env.SPS_HANDOFF_KID_DEFAULT = 'bad/kid';
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS })).toThrow(/not set, malformed/);
  });
});

describe('mintAbwS2sToken — round 8 scope parameter', () => {
  it('exports correct scope constants', () => {
    expect(MINT_SITE_CONFIG_SCOPE).toBe('mint-site-config');
    expect(ASSIGN_NEW_CUSTOMER_SCOPE).toBe('assign-new-customer');
  });

  it('default scope (omitted) is mint-site-config (backward compat with round 6)', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.scope).toBe('mint-site-config');
  });

  it('scope=mint-site-config is the same as default (explicit form)', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS, scope: MINT_SITE_CONFIG_SCOPE });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.scope).toBe('mint-site-config');
  });

  it('scope=assign-new-customer mints with the round-8 scope claim', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS, scope: ASSIGN_NEW_CUSTOMER_SCOPE });
    const [, payloadB64] = tok.split('.');
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(payload.scope).toBe('assign-new-customer');
    // Other claims must still be locked per round 6 (iss/aud/lifetime cap)
    expect(payload.iss).toBe('abw');
    expect(payload.aud).toBe('sps');
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(300);
  });

  it('signature verifies under shared secret for assign-new-customer scope', () => {
    const tok = mintAbwS2sToken({ spsWorkspaceId: WS, scope: ASSIGN_NEW_CUSTOMER_SCOPE });
    const [headerB64, payloadB64, sigB64] = tok.split('.');
    const expected = createHmac('sha256', TEST_KEY_RAW)
      .update(`${headerB64}.${payloadB64}`)
      .digest()
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(sigB64).toBe(expected);
  });

  it('lifetime cap (300s) applies regardless of scope', () => {
    expect(() => mintAbwS2sToken({ spsWorkspaceId: WS, scope: ASSIGN_NEW_CUSTOMER_SCOPE, lifetimeSec: 301 }))
      .toThrow(/exceeds SPS cap of 300s/);
  });

  it('UUID validation applies regardless of scope', () => {
    expect(() => mintAbwS2sToken({ spsWorkspaceId: 'not-a-uuid', scope: ASSIGN_NEW_CUSTOMER_SCOPE }))
      .toThrow(/not a UUID/);
  });
});
