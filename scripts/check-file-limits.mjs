import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TEXT_LINES = 1200;

const LINE_LIMIT_EXEMPT_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

const TEXT_EXTENSIONS = new Set([
  '.bash',
  '.c',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.md',
  '.mdx',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.xml',
  '.yaml',
  '.yml',
]);

function isTextFile(filePath) {
  const extensionIndex = filePath.lastIndexOf('.');
  if (extensionIndex >= 0 && TEXT_EXTENSIONS.has(filePath.slice(extensionIndex).toLowerCase())) {
    return true;
  }

  return ['Dockerfile', 'Makefile'].includes(basename(filePath));
}

export function countLines(contents) {
  if (contents.length === 0) {
    return 0;
  }

  const newlines = contents.toString('utf8').match(/\n/g)?.length ?? 0;
  return newlines + (contents.at(-1) === 10 ? 0 : 1);
}

export function inspectFile(
  filePath,
  contents,
  { maxFileBytes = MAX_FILE_BYTES, maxTextLines = MAX_TEXT_LINES } = {},
) {
  const violations = [];

  if (contents.byteLength > maxFileBytes) {
    violations.push({
      filePath,
      kind: 'bytes',
      actual: contents.byteLength,
      limit: maxFileBytes,
    });
  }

  if (isTextFile(filePath) && !LINE_LIMIT_EXEMPT_FILES.has(basename(filePath))) {
    const lines = countLines(contents);
    if (lines > maxTextLines) {
      violations.push({
        filePath,
        kind: 'lines',
        actual: lines,
        limit: maxTextLines,
      });
    }
  }

  return violations;
}

function listCandidateFiles(repositoryRoot) {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
    },
  );

  if (result.status !== 0) {
    const error = result.stderr.toString('utf8').trim();
    throw new Error(`Could not list repository files: ${error}`);
  }

  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

export function findViolations(repositoryRoot, limits) {
  return listCandidateFiles(repositoryRoot).flatMap((filePath) => {
    const absolutePath = resolve(repositoryRoot, filePath);
    if (!existsSync(absolutePath)) {
      return [];
    }

    const file = lstatSync(absolutePath);
    if (!file.isFile()) {
      return [];
    }

    const maxFileBytes = limits?.maxFileBytes ?? MAX_FILE_BYTES;
    if (file.size > maxFileBytes) {
      return [
        {
          filePath,
          kind: 'bytes',
          actual: file.size,
          limit: maxFileBytes,
        },
      ];
    }

    return inspectFile(filePath, readFileSync(absolutePath), limits);
  });
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`;
}

function run() {
  const repositoryRoot = process.cwd();
  const violations = findViolations(repositoryRoot);

  if (violations.length === 0) {
    console.log(
      `File limits passed (${formatBytes(MAX_FILE_BYTES)} per file, ${MAX_TEXT_LINES} lines per text file).`,
    );
    return;
  }

  console.error('File limit violations:');
  for (const violation of violations) {
    if (violation.kind === 'bytes') {
      console.error(
        `- ${violation.filePath}: ${formatBytes(violation.actual)} exceeds ${formatBytes(violation.limit)}`,
      );
    } else {
      console.error(
        `- ${violation.filePath}: ${violation.actual} lines exceeds ${violation.limit} lines`,
      );
    }
  }
  console.error(
    '\nSplit large source files. Store required large binary assets with Git LFS or a release artifact.',
  );
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
