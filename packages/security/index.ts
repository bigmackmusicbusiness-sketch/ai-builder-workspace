// packages/security/index.ts — shared secret patterns, redactor, authz types.
// Vault lives inside apps/api (server-only). This package carries only shared
// non-secret logic used by both api and verify adapters.
export * from './patterns';
