import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'coverage/**',
      'public/sw.js',
      '**/*.d.ts', // generated (e.g. next-env.d.ts)
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build-time config files run in Node, not the browser.
    files: ['*.mjs', '*.config.ts', 'next.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The service worker runs in a worker global scope, not a window.
    files: ['src/app/sw.ts'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
