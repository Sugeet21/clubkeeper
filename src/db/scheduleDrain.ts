// Phase C — drain scheduler.
//
// Chunk 3 ships this as a no-op stub so syncWrappers can be built + tested in
// isolation without any Supabase coupling. Chunk 4 replaces the body with the
// real SyncRunner.scheduleDrain implementation (exponential backoff, online
// listener, 30s interval kick).
//
// Wrappers MUST import this — calling SyncRunner directly would defeat the
// isolation. By going through one module, Chunk 4's swap is invisible to
// every caller.

let stub = true

export function scheduleDrain(): void {
  // No-op until Chunk 4 wires the real runner. Logged once in DEV so
  // misconfigured Chunk 4 deploys are obvious during smoke-tests.
  if (stub && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[scheduleDrain] stub — Chunk 4 not yet wired')
    stub = false
  }
}
