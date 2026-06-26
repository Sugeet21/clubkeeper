// Phase C — drain scheduler indirection.
//
// Wrappers (syncWrappers.ts) import { scheduleDrain } from './scheduleDrain'.
// Chunk 3 shipped this as a no-op stub. Chunk 4 swaps the body for a thin
// forwarder to the real SyncRunner so wrappers' import path stays stable.
//
// Going through this indirection (instead of letting wrappers import
// syncRunner directly) means future swaps — e.g. a queue-coalescing layer
// between wrapper-commit and SyncRunner — drop in here without touching the
// 9 wrapper call sites.

export { scheduleDrain } from './syncRunner'
