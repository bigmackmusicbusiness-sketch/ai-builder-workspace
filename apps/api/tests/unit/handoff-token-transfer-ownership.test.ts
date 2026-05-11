// apps/api/tests/unit/handoff-token-transfer-ownership.test.ts
//
// Round 8 Feature B adds a third HandoffScope: `transfer-ownership`.
// SPS uses it to re-parent an ABW project from the agency tenant to the
// customer's workspace after Stripe invoice payment.
//
// This file proves:
//   - The verifier accepts a properly-shaped 'transfer-ownership' token
//   - Wrong scope → HandoffTokenError('bad scope ...')
//   - Other claim mismatches (iss/aud/sig/exp) → expected error reasons
//   - Round 6 + round 8 scopes coexist (no regression on existing flows)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.SUPABASE_URL              ??= 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY         ??= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  process.env.SUPABASE_JWT_SECRET       ??= 'test-jwt-secret';
  process.env.VAULT_MASTER_KEY          ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
});

import {
  HandoffTokenError,
  PROJECT_CREATE_SCOPE,
  PROJECT_HANDOFF_SCOPE,
  TRANSFER_OWNERSHIP_SCOPE,
  __testMintHandoffToken,
  verifyHandoffToken,
} from '../../src/security/handoffToken';

const WS = '11111111-2222-3333-4444-555555555555';
const PROJECT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TEST_KEY = Buffer.alloc(32, 0x42);
const KID = 'k1';

beforeEach(() => {
  process.env.SPS_HANDOFF_KID_DEFAULT = KID;
  process.env.SPS_HANDOFF_KEY_K1      = TEST_KEY.toString('base64');
});

afterEach(() => {
  delete process.env.SPS_HANDOFF_KID_DEFAULT;
  delete process.env.SPS_HANDOFF_KEY_K1;
});

function nowSec() { return Math.floor(Date.now() / 1000); }

describe('handoffToken — scope constants exported', () => {
  it('PROJECT_CREATE_SCOPE = "project-create"', () => {
    expect(PROJECT_CREATE_SCOPE).toBe('project-create');
  });
  it('PROJECT_HANDOFF_SCOPE = "project-handoff"', () => {
    expect(PROJECT_HANDOFF_SCOPE).toBe('project-handoff');
  });
  it('TRANSFER_OWNERSHIP_SCOPE = "transfer-ownership" (round 8 new)', () => {
    expect(TRANSFER_OWNERSHIP_SCOPE).toBe('transfer-ownership');
  });
});

describe('handoffToken — transfer-ownership verify (round 8)', () => {
  it('accepts a properly-shaped transfer-ownership token', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: {
        iat: now, exp: now + 60,
        scope: TRANSFER_OWNERSHIP_SCOPE,
        sps_workspace_id: WS,
        project_id: PROJECT_ID,
      },
    });
    const payload = verifyHandoffToken(tok, TRANSFER_OWNERSHIP_SCOPE);
    expect(payload.scope).toBe('transfer-ownership');
    expect(payload.sps_workspace_id).toBe(WS);
    expect(payload.project_id).toBe(PROJECT_ID);
  });

  it('rejects when token scope ≠ expectedScope', () => {
    const now = nowSec();
    // Mint with scope=project-create, ask verifier for transfer-ownership
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: { iat: now, exp: now + 60, scope: 'project-create', sps_workspace_id: WS },
    });
    expect(() => verifyHandoffToken(tok, TRANSFER_OWNERSHIP_SCOPE))
      .toThrow(/bad scope/i);
  });

  it('rejects expired transfer-ownership token', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: {
        iat: now - 120, exp: now - 60,
        scope: TRANSFER_OWNERSHIP_SCOPE,
        sps_workspace_id: WS,
      },
    });
    expect(() => verifyHandoffToken(tok, TRANSFER_OWNERSHIP_SCOPE))
      .toThrow(/expired/i);
  });

  it('rejects when lifetime > 300s cap', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: {
        iat: now, exp: now + 500,
        scope: TRANSFER_OWNERSHIP_SCOPE,
        sps_workspace_id: WS,
      },
    });
    expect(() => verifyHandoffToken(tok, TRANSFER_OWNERSHIP_SCOPE))
      .toThrow(/exceeds/i);
  });

  it('rejects bad sps_workspace_id (not a UUID)', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: {
        iat: now, exp: now + 60,
        scope: TRANSFER_OWNERSHIP_SCOPE,
        sps_workspace_id: 'not-a-uuid',
      },
    });
    expect(() => verifyHandoffToken(tok, TRANSFER_OWNERSHIP_SCOPE))
      .toThrow(HandoffTokenError);
  });

  it('rejects unknown kid', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: 'k_unknown',
      payload: {
        iat: now, exp: now + 60,
        scope: TRANSFER_OWNERSHIP_SCOPE,
        sps_workspace_id: WS,
      },
    });
    expect(() => verifyHandoffToken(tok, TRANSFER_OWNERSHIP_SCOPE))
      .toThrow(/unknown kid/i);
  });

  it('rejects tampered signature', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: {
        iat: now, exp: now + 60,
        scope: TRANSFER_OWNERSHIP_SCOPE,
        sps_workspace_id: WS,
      },
    });
    // Tamper: replace last 8 chars of signature
    const tampered = tok.slice(0, -8) + 'AAAAAAAA';
    expect(() => verifyHandoffToken(tampered, TRANSFER_OWNERSHIP_SCOPE))
      .toThrow(/signature/i);
  });
});

describe('handoffToken — round 6 + round 8 coexist', () => {
  it('project-create still verifies (no regression)', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: { iat: now, exp: now + 60, scope: PROJECT_CREATE_SCOPE, sps_workspace_id: WS },
    });
    const payload = verifyHandoffToken(tok, PROJECT_CREATE_SCOPE);
    expect(payload.scope).toBe('project-create');
  });

  it('project-handoff still verifies (no regression)', () => {
    const now = nowSec();
    const tok = __testMintHandoffToken({
      key: TEST_KEY, kid: KID,
      payload: { iat: now, exp: now + 60, scope: PROJECT_HANDOFF_SCOPE, sps_workspace_id: WS, project_id: PROJECT_ID },
    });
    const payload = verifyHandoffToken(tok, PROJECT_HANDOFF_SCOPE);
    expect(payload.scope).toBe('project-handoff');
    expect(payload.project_id).toBe(PROJECT_ID);
  });
});
