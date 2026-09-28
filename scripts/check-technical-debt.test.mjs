import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findUntrackedDebt } from './check-technical-debt.mjs';

const marker = 'TO' + 'DO';
const fixMarker = 'FIX' + 'ME';
const hackMarker = 'HA' + 'CK';
const warningMarker = 'X' + 'XX';

test('accepts local and full GitHub issue references with explanations', () => {
  const source = [
    `// ${marker}(#42): remove this adapter after the provider migration`,
    `// ${fixMarker}(https://github.com/smash4920/gtm-partner-dashboard/issues/87): handle retries`,
    `// ${hackMarker}(#91): replace the vendor workaround`,
    `// ${warningMarker}(#99): document this temporary invariant`,
  ].join('\n');

  assert.deepEqual(findUntrackedDebt('src/example.ts', source), []);
});

test('rejects markers without issue references or explanations', () => {
  const source = [
    `// ${marker}: remove this adapter`,
    `// ${fixMarker}(#87)`,
    `// ${marker}(#42):`,
  ].join('\n');

  assert.deepEqual(findUntrackedDebt('src/example.ts', source), [
    { column: 4, filePath: 'src/example.ts', line: 1, marker },
    { column: 4, filePath: 'src/example.ts', line: 2, marker: fixMarker },
    { column: 4, filePath: 'src/example.ts', line: 3, marker },
  ]);
});

test('reports every marker with an actionable location', () => {
  const source = `const value = 1; // ${marker} and ${fixMarker}`;

  assert.deepEqual(findUntrackedDebt('src/example.ts', source), [
    { column: 21, filePath: 'src/example.ts', line: 1, marker },
    { column: 30, filePath: 'src/example.ts', line: 1, marker: fixMarker },
  ]);
});

test('does not treat words containing marker text as debt markers', () => {
  assert.deepEqual(findUntrackedDebt('src/example.ts', 'const methodology = "fixed";'), []);
});
