// Build-time constants inlined by esbuild's `define` (see apps/api/build.mjs).
// In dev (tsx watch — no esbuild bundle), these are undefined; the /healthz
// route falls back to 'unknown' for either name.

declare const __BUILD_SHA__:  string | undefined;
declare const __BUILD_TIME__: string | undefined;
