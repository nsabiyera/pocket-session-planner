import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // jsdom, not node: the data layer runs against fake-indexeddb and the
    // component tests need a DOM. Nothing here talks to a real browser.
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'out/**', '.next/**'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // The correctness surface: pure domain rules, the persistence layer and the
      // services that compose them. The App Router tree is verified on a device,
      // not by the unit gate.
      include: ['src/domain/**', 'src/data/**', 'src/modules/**', 'src/lib/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'src/**/index.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
