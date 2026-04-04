import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readRepositoryFile = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

const runBundleTypecheck = () => {
  const tscCliPath = path.resolve(
    process.cwd(),
    'node_modules/typescript/bin/tsc',
  );
  const bundleTsconfigPath = path.resolve(process.cwd(), 'tsconfig.bundle.json');
  return spawnSync(
    process.execPath,
    [tscCliPath, '--project', bundleTsconfigPath, '--noEmit'],
    {
      encoding: 'utf8',
      shell: false,
    },
  );
};

test('release workflow delegates browser bundle build to package script', async () => {
  const workflow = await readRepositoryFile('.github/workflows/ci-release.yml');

  assert.match(workflow, /- name: Build browser minified bundle/);
  assert.match(workflow, /run:\s+pnpm build:bundle/);
  assert.doesNotMatch(workflow, /pnpm exec esbuild/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /dist\/frostpillar-storage-engine\.min\.js/);
});

test('release workflow excludes browser bundle artifact from npm publish payload', async () => {
  const workflow = await readRepositoryFile('.github/workflows/ci-release.yml');

  assert.match(
    workflow,
    /- name: Remove browser bundle from npm publish payload/,
  );
  assert.match(workflow, /rm -f dist\/frostpillar-storage-engine\.min\.js/);
  assert.match(
    workflow,
    /if \[\[ -f dist\/frostpillar-storage-engine\.min\.js \]\]; then[\s\S]*exit 1[\s\S]*fi/,
  );
});

test('package scripts declare dedicated browser bundle build command', async () => {
  const packageJson = JSON.parse(await readRepositoryFile('package.json'));
  const script = packageJson.scripts['build:bundle'];

  assert.ok(script, 'build:bundle script must be defined');
  assert.match(script, /tsc --project tsconfig\.bundle\.json --noEmit/);
  assert.match(script, /esbuild src\/index\.ts/);
});

test('bundle TypeScript profile enforces ES2020 and Bundler resolution', async () => {
  const profile = JSON.parse(await readRepositoryFile('tsconfig.bundle.json'));
  const { compilerOptions } = profile;

  assert.equal(compilerOptions.target, 'ES2020');
  assert.equal(compilerOptions.moduleResolution, 'Bundler');
});

test('bundle TypeScript profile type-check succeeds without post-ES2020 globals', () => {
  const result = runBundleTypecheck();
  if (result.error !== undefined) {
    throw result.error;
  }
  assert.equal(
    result.status,
    0,
    `bundle type-check failed.\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
  );
});

test('browser bundle build script pins esbuild output contract', async () => {
  const packageJson = JSON.parse(await readRepositoryFile('package.json'));
  const script = packageJson.scripts['build:bundle'];

  assert.match(script, /--bundle/);
  assert.match(script, /--minify/);
  assert.match(script, /--target=es2020/);
  assert.match(script, /--platform=browser/);
  assert.match(script, /--format=iife/);
  assert.match(script, /--global-name=FrostpillarStorageEngine/);
  assert.match(script, /--outfile=dist\/frostpillar-storage-engine\.min\.js/);
});

test('npm module build profile remains independent from browser bundle target', async () => {
  const profile = JSON.parse(await readRepositoryFile('tsconfig.json'));
  const { compilerOptions } = profile;

  assert.equal(compilerOptions.target, 'ES2022');
  assert.equal(compilerOptions.module, 'NodeNext');
});

test('npm package remains tree-shakeable by metadata contract', async () => {
  const packageJson = JSON.parse(await readRepositoryFile('package.json'));

  assert.equal(packageJson.sideEffects, false);
});
