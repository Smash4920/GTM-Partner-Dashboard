import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const debtMarkers = ['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK', 'X' + 'XX'];
const markerPattern = new RegExp(`\\b(${debtMarkers.join('|')})\\b`, 'g');
const issueReferencePattern =
  /^\((#\d+|https:\/\/github\.com\/smash4920\/gtm-partner-dashboard\/issues\/\d+)\):\s+\S/;
const checkedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.scss',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

export function findUntrackedDebt(filePath, source) {
  const violations = [];

  for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
    markerPattern.lastIndex = 0;

    for (const match of line.matchAll(markerPattern)) {
      const marker = match[0];
      const suffix = line.slice(match.index + marker.length);

      if (!issueReferencePattern.test(suffix)) {
        violations.push({
          column: match.index + 1,
          filePath,
          line: lineIndex + 1,
          marker,
        });
      }
    }
  }

  return violations;
}

export function trackedSourceFiles(root = repositoryRoot) {
  const output = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );

  return output
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => checkedExtensions.has(extname(filePath)));
}

export function checkRepository(root = repositoryRoot) {
  return trackedSourceFiles(root).flatMap((filePath) => {
    const absolutePath = resolve(root, filePath);

    return existsSync(absolutePath)
      ? findUntrackedDebt(filePath, readFileSync(absolutePath, 'utf8'))
      : [];
  });
}

function run() {
  const violations = checkRepository();

  if (violations.length === 0) {
    console.log('Technical debt markers are linked to GitHub issues.');
    return;
  }

  console.error('Untracked technical debt markers found:');
  for (const violation of violations) {
    console.error(
      `  ${violation.filePath}:${violation.line}:${violation.column} ` +
        `${violation.marker} must include an issue reference and explanation`,
    );
  }
  console.error(
    '\nUse MARKER(#123): explanation or ' +
      'MARKER(https://github.com/smash4920/gtm-partner-dashboard/issues/123): explanation.',
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
