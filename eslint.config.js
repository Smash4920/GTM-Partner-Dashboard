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
      ],
      'boundaries/elements-single-match': true,
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
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
);
