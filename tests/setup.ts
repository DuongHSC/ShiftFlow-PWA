// ShiftFlow PWA — Tests
// tests/setup.ts
//
// Registers fake-indexeddb so Dexie works under Vitest (jsdom). Loaded via
// vitest.config.ts setupFiles.

import "fake-indexeddb/auto";
