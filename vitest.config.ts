import { defineConfig } from 'vitest/config'

// Pure logic and IndexedDB persistence only — fake-indexeddb stands in for
// the browser's IndexedDB, so no DOM environment is needed.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts'],
  },
})
