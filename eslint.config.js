import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-artifact/**', 'artifacts/**', 'node_modules/**', '.vite/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // The sim is engine-free: it must stay pure TypeScript so it can be unit
  // tested in Node and so render never leaks into game logic (CLAUDE.md).
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@babylonjs', '@babylonjs/**'],
              message:
                'src/sim must stay engine-free: no Babylon.js imports (see CLAUDE.md / docs/03-milestone-1-plan.md).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['*.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
