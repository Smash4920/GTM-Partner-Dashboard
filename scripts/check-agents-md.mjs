import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INTENTIONALLY_ABSENT_PATHS = new Set(['.factory', 'dist', 'node_modules']);
const REPOSITORY_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

function shellCommands(markdown) {
  const commands = [];
  const fencePattern = /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g;

  for (const match of markdown.matchAll(fencePattern)) {
    for (const line of match[1].split('\n')) {
      const command = line.replace(/\s+#.*$/, '').trim();
      if (command && !command.startsWith('#')) {
        commands.push(command);
      }
    }
  }

  return commands;
}

function repositoryPaths(markdown) {
  const paths = new Set();
  const inlineCodePattern = /(?<!`)`([^`\n]+)`(?!`)/g;

  for (const match of markdown.matchAll(inlineCodePattern)) {
    const value = match[1].trim();
    if (
      value.includes('*') ||
      value.includes(' ') ||
      value.startsWith('/') ||
      value.includes('://')
    ) {
      continue;
    }

    const normalized = value.replace(/\/$/, '');
    const firstSegment = normalized.split('/')[0];
    const isRepositoryPath =
      normalized.includes('/') ||
      REPOSITORY_FILE_EXTENSIONS.has(extname(normalized)) ||
      firstSegment === '.github' ||
      firstSegment === 'docs' ||
      firstSegment === 'scripts' ||
      firstSegment === 'src';

    if (isRepositoryPath && !INTENTIONALLY_ABSENT_PATHS.has(normalized)) {
      paths.add(normalized);
    }
  }

  return [...paths];
}

export function validateAgentsMarkdown({ markdown, packageJson, repositoryRoot }) {
  const violations = [];
  const scripts = packageJson.scripts ?? {};

  for (const command of shellCommands(markdown)) {
    if (command === 'npm ci') {
      if (!existsSync(resolve(repositoryRoot, 'package-lock.json'))) {
        violations.push('`npm ci` is documented, but package-lock.json does not exist.');
      }
      continue;
    }

    const npmRunMatch = command.match(
      /^npm run ([A-Za-z0-9:._-]+)(?:\s+(?:--|[A-Za-z0-9_./:@=+-]+))*$/,
    );
    const npmTestMatch = command.match(/^npm test(?:\s+(?:--|[A-Za-z0-9_./:@=+-]+))*$/);
    const scriptName = npmRunMatch?.[1] ?? (npmTestMatch ? 'test' : undefined);

    if (!scriptName) {
      violations.push(`Documented shell command is not validated: \`${command}\`.`);
    } else if (!(scriptName in scripts)) {
      violations.push(
        `Documented command \`${command}\` references missing package script \`${scriptName}\`.`,
      );
    }
  }

  for (const path of repositoryPaths(markdown)) {
    if (!existsSync(resolve(repositoryRoot, path))) {
      violations.push(`Documented repository path does not exist: \`${path}\`.`);
    }
  }

  return violations;
}

function run() {
  const repositoryRoot = process.cwd();
  const agentsPath = resolve(repositoryRoot, 'AGENTS.md');
  const packagePath = resolve(repositoryRoot, 'package.json');

  if (!existsSync(agentsPath)) {
    console.error('AGENTS.md freshness check failed: AGENTS.md does not exist.');
    process.exitCode = 1;
    return;
  }

  const violations = validateAgentsMarkdown({
    markdown: readFileSync(agentsPath, 'utf8'),
    packageJson: JSON.parse(readFileSync(packagePath, 'utf8')),
    repositoryRoot,
  });

  if (violations.length === 0) {
    console.log('AGENTS.md freshness check passed: documented commands and paths are valid.');
    return;
  }

  console.error('AGENTS.md freshness check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
