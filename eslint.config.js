import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `coverage` is a generated v8 report, not source; it is only ignored by
  // .gitignore, which eslint does not read.
  { ignores: ['dist', 'coverage', 'node_modules'] },
  ...tseslint.configs.recommended,
);
