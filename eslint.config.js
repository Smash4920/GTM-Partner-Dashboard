import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const allowDependencies = (from, allowed) => ({
  from: { element: { type: from } },
  allow: { to: { element: { types: { anyOf: allowed } } } },
});

export default tseslint.config(
  // `coverage` is a generated v8 report, not source; it is only ignored by
  // .gitignore, which eslint does not read.
  { ignores: ['dist', 'coverage', 'node_modules'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        {
          type: 'provider',
          pattern: 'src/data/mock',
          partialMatch: false,
        },
        {
          type: 'view',
          pattern: 'src/views',
          partialMatch: false,
        },
        {
          type: 'component',
          pattern: 'src/components',
          partialMatch: false,
        },
        {
          type: 'data',
          pattern: 'src/data',
          partialMatch: false,
        },
        {
          type: 'domain',
          pattern: 'src/lib',
          partialMatch: false,
        },
        {
          type: 'test-support',
          pattern: 'src/test',
          partialMatch: false,
        },
        {
          type: 'app',
          pattern: 'src',
          partialMatch: false,
        },
      ],
      // File categories let tests cross layers for fixtures without granting
      // those same imports to production files in the directory.
      'boundaries/files': [
        {
          category: 'test',
          pattern: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
        },
        {
          // Feature-flag registry, governance, and evaluation — including the
          // operational telemetry registry. These modules sit inside the
          // domain element but carry a stricter contract, enforced by the
          // flag-module policy below.
          category: 'flag-module',
          pattern: [
            'src/lib/featureFlags.ts',
            'src/lib/flagGovernance.ts',
            'src/lib/flagRuntime.ts',
            'src/lib/productFlagDefinitions.ts',
            'src/lib/telemetry/flags.ts',
            'src/lib/telemetry/flagDefinitions.ts',
          ],
        },
      ],
      'boundaries/elements-single-match': true,
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
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
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'This import violates the configured module dependency direction. Keep dependencies flowing toward reusable components, data contracts, and domain helpers.',
          policies: [
            allowDependencies('app', ['app', 'view', 'component', 'data', 'provider', 'domain']),
            allowDependencies('view', ['view', 'component', 'data', 'domain']),
            allowDependencies('component', ['component', 'data', 'domain']),
            allowDependencies('data', ['data', 'provider', 'domain']),
            allowDependencies('provider', ['provider', 'data', 'domain']),
            allowDependencies('domain', ['domain', 'data']),
            {
              // Flag modules may never import access-scope, provider, or
              // authorization logic: a flag can hide a feature but must not be
              // able to grant a role or a row, even by accident. This deny
              // policy must stay AFTER the element allow policies above —
              // policies evaluate last-match-wins, so a later generic allow
              // must not reopen this boundary.
              from: { file: { categories: 'flag-module' } },
              disallow: {
                to: {
                  element: {
                    types: {
                      anyOf: ['app', 'view', 'component', 'data', 'provider', 'test-support'],
                    },
                  },
                },
              },
              message:
                'Feature-flag modules cannot import access-scope, provider, or application logic. Flags never grant roles or rows.',
            },
            {
              from: { file: { categories: 'test' } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'app',
                        'view',
                        'component',
                        'data',
                        'provider',
                        'domain',
                        'test-support',
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    // The source adapters in src/data/normalizers model other systems'
    // payloads — CRM `__c` custom fields, PRM snake_case. Those keys are the
    // contract under validation; renaming them to our conventions would
    // misdescribe the wire shape. Everything else in the directory follows
    // the project conventions unchanged.
    files: ['src/data/normalizers/**'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'property', format: null },
      ],
    },
  },
);
