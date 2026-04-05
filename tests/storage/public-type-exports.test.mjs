import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('public root type exports include DatastoreDriverSnapshot for custom drivers', async () => {
  const indexSource = await readFile(
    path.resolve(process.cwd(), 'src/index.ts'),
    'utf8',
  );

  assert.match(indexSource, /DatastoreDriverSnapshot/);
});

test('public root type exports include PayloadLimitsConfig for custom payload limits', async () => {
  const indexSource = await readFile(
    path.resolve(process.cwd(), 'src/index.ts'),
    'utf8',
  );

  assert.match(indexSource, /PayloadLimitsConfig/);
});
