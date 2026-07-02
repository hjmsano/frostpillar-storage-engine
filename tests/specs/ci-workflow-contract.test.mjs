import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const readCiWorkflow = async () => {
  const absolutePath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  return parse(await readFile(absolutePath, 'utf8'));
};

test('ci workflow runs the quality gate on pull requests', async () => {
  const workflow = await readCiWorkflow();

  assert.ok(workflow.on, 'workflow must declare triggers under "on"');
  assert.ok('pull_request' in workflow.on, 'pull_request trigger is required');
});

test('ci workflow push trigger is restricted to main', async () => {
  const workflow = await readCiWorkflow();
  const push = workflow.on.push;

  assert.ok(push, 'push trigger is required');
  assert.deepEqual(push.branches, ['main']);
  assert.equal('branches-ignore' in push, false);
  assert.equal('tags-ignore' in push, false);
});

test('ci workflow runs lint-and-test on a single ubuntu runner', async () => {
  const workflow = await readCiWorkflow();
  const job = workflow.jobs['lint-and-test'];

  assert.ok(job, 'lint-and-test job is required');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(
    'strategy' in job,
    false,
    'OS matrix must not be used (Frostpillar family CI convention)',
  );
});

test('ci workflow keeps Node.js 24 with pnpm cache and frozen lockfile', async () => {
  const workflow = await readCiWorkflow();
  const steps = workflow.jobs['lint-and-test'].steps;

  const nodeSetup = steps.find(
    (step) => step.with?.['node-version'] !== undefined,
  );
  assert.ok(nodeSetup, 'a Node.js setup step is required');
  assert.equal(nodeSetup.with['node-version'], '24.x');
  assert.equal(nodeSetup.with.cache, 'pnpm');

  const runCommands = steps
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');
  assert.ok(runCommands.includes('pnpm install --frozen-lockfile'));
  assert.ok(runCommands.includes('pnpm check'));
});
