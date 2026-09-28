import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countLines, inspectFile } from './check-file-limits.mjs';

describe('file limit checks', () => {
  it('counts empty, terminated, and unterminated text correctly', () => {
    assert.equal(countLines(Buffer.from('')), 0);
    assert.equal(countLines(Buffer.from('first\nsecond\n')), 2);
    assert.equal(countLines(Buffer.from('first\nsecond')), 2);
  });

  it('reports byte and line violations together', () => {
    const violations = inspectFile('src/large.ts', Buffer.from('a\nb\nc'), {
      maxFileBytes: 4,
      maxTextLines: 2,
    });

    assert.deepEqual(violations, [
      {
        filePath: 'src/large.ts',
        kind: 'bytes',
        actual: 5,
        limit: 4,
      },
      {
        filePath: 'src/large.ts',
        kind: 'lines',
        actual: 3,
        limit: 2,
      },
    ]);
  });

  it('applies byte limits but not hand-maintained line limits to lockfiles', () => {
    const violations = inspectFile('package-lock.json', Buffer.from('{}\n{}\n'), {
      maxFileBytes: 5,
      maxTextLines: 1,
    });

    assert.deepEqual(violations, [
      {
        filePath: 'package-lock.json',
        kind: 'bytes',
        actual: 6,
        limit: 5,
      },
    ]);
  });
});
