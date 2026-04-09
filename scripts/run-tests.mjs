import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

const args = process.argv.slice(2);

const nodeFlags = new Set([
  '--experimental-test-coverage',
  '--test-coverage-branches',
  '--test-coverage-functions',
  '--test-coverage-lines',
  '--test-coverage-exclude',
  '--test-coverage-include',
]);

const isNodeFlag = (arg) =>
  nodeFlags.has(arg) ||
  [...nodeFlags].some((flag) => arg.startsWith(`${flag}=`));

const extraNodeArgs = args.filter((arg) => isNodeFlag(arg));
const restArgs = args.filter((arg) => !isNodeFlag(arg));

const normalizeTestTargets = () => {
  if (restArgs.length === 0) {
    return ['tests/**/*.test.mjs'];
  }

  if (restArgs[0] !== '--run') {
    return restArgs;
  }

  if (restArgs.length === 1) {
    return ['tests/**/*.test.mjs'];
  }

  return restArgs.slice(1);
};

const testTargets = normalizeTestTargets();

const tscCliPath = path.resolve(
  repositoryRoot,
  'node_modules/typescript/bin/tsc',
);
const buildResult = spawnSync(
  process.execPath,
  [tscCliPath, '--build', '--force'],
  {
    stdio: 'inherit',
    shell: false,
    cwd: repositoryRoot,
  },
);

if (buildResult.error !== undefined) {
  throw buildResult.error;
}

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const result = spawnSync(
  process.execPath,
  ['--test', ...extraNodeArgs, ...testTargets],
  {
    stdio: 'inherit',
    shell: false,
    cwd: repositoryRoot,
  },
);

if (result.error !== undefined) {
  throw result.error;
}

process.exit(result.status ?? 1);
