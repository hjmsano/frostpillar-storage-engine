import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readRepositoryFile = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('ci workflow runs the quality gate on pull requests', async () => {
  const workflow = await readRepositoryFile('.github/workflows/ci.yml');

  assert.match(workflow, /^on:$/m);
  assert.match(workflow, /^ {2}pull_request:/m);
});

test('ci workflow push trigger is restricted to main', async () => {
  const workflow = await readRepositoryFile('.github/workflows/ci.yml');

  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main\b/);
  assert.doesNotMatch(workflow, /branches-ignore/);
  assert.doesNotMatch(workflow, /tags-ignore/);
});

test('ci workflow runs lint-and-test on an OS matrix', async () => {
  const workflow = await readRepositoryFile('.github/workflows/ci.yml');

  assert.match(workflow, /^ {4}strategy:/m);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /os: \[ubuntu-latest, macos-latest\]/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/);
});

test('ci workflow keeps Node.js 24 with pnpm cache and frozen lockfile', async () => {
  const workflow = await readRepositoryFile('.github/workflows/ci.yml');

  assert.match(workflow, /node-version: 24\.x/);
  assert.match(workflow, /cache: pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /run: pnpm check/);
});
