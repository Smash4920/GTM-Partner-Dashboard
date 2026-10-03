import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = [
  {
    spec: 'accessibility-modals.spec.ts',
    prefix: 'gtm-modal-a11y-',
    builder: fileURLToPath(new URL('../tests/fixtures/modals/build.mjs', import.meta.url)),
    variable: 'E2E_MODAL_FIXTURE_DIR',
  },
  {
    spec: 'accessibility-inline-notifications.spec.ts',
    prefix: 'gtm-inline-a11y-',
    builder: fileURLToPath(
      new URL('../tests/fixtures/inline-notifications/build.mjs', import.meta.url),
    ),
    variable: 'E2E_INLINE_FIXTURE_DIR',
  },
];

export function assertWorkerLimit(workers) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) {
    throw new Error(
      'Ordinary E2E requires 1..4 workers, reserving the fifth validator for manual checks',
    );
  }
}

// Prepare immutable assets once in the parent, never once per parallel group.
// Each browser still owns its fresh context/provider/session state.
export function prepareFixtures(selected, root, build = buildFixture) {
  const directories = [];
  const env = {};
  const cleanup = () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  };
  try {
    for (const fixture of FIXTURES) {
      if (!selected.some((file) => file.endsWith(fixture.spec))) continue;
      const directory = mkdtempSync(join(tmpdir(), fixture.prefix));
      directories.push(directory);
      build(fixture.builder, directory, root);
      env[fixture.variable] = directory;
    }
    return { env, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function buildFixture(builder, directory, root) {
  const result = spawnSync(process.execPath, [builder, directory], {
    cwd: root,
    stdio: 'inherit',
    timeout: 90_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Fixture build failed: ${builder}`);
}
