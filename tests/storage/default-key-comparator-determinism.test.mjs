import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

test('default string key comparator uses deterministic code-point ordering', async () => {
  const { DEFAULT_STRING_KEY_DEFINITION } = await importDistModule(
    'storage/datastore/datastoreKeyDefinition.js',
  );

  assert.equal(DEFAULT_STRING_KEY_DEFINITION.compare('a', 'a'), 0);
  assert.equal(DEFAULT_STRING_KEY_DEFINITION.compare('a', 'b'), -1);
  assert.equal(DEFAULT_STRING_KEY_DEFINITION.compare('b', 'a'), 1);
  assert.equal(DEFAULT_STRING_KEY_DEFINITION.compare('z', 'ä'), -1);
  assert.equal(DEFAULT_STRING_KEY_DEFINITION.compare('ä', 'z'), 1);
});

test('default string key comparator source does not depend on localeCompare', async () => {
  const source = await readFile(
    path.resolve(process.cwd(), 'src/storage/datastore/datastoreKeyDefinition.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /\.localeCompare\(/);
});
