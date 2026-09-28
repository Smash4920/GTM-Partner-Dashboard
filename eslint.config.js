import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `coverage` is a generated v8 report, not source; it is only ignored by
  // .gitignore, which eslint does not read.
  { ignores: ['dist', 'coverage', 'node_modules'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Keep control flow reviewable. New hotspots fail locally and in CI
      // before they can grow beyond the team's agreed complexity budget.
      complexity: ['error', { max: 20 }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'property',
          format: ['camelCase', 'UPPER_CASE'],
        },
        {
          selector: 'property',
          modifiers: ['requiresQuotes'],
          format: null,
        },
      ],
    },
  },
);
