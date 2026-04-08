import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import path from 'node:path';

import { ensureCanonicalPathWithinWorkingDirectory } from '../../dist/storage/config/config.node.js';
import { ConfigurationError } from '../../dist/errors/index.js';

describe('file error path sanitization', () => {
  test('path traversal error does not leak absolute working directory', () => {
    const cwd = process.cwd();
    try {
      ensureCanonicalPathWithinWorkingDirectory('/etc/passwd', 'filePath');
      assert.fail('Expected ConfigurationError');
    } catch (error) {
      assert.ok(error instanceof ConfigurationError);
      assert.ok(
        !error.message.includes(cwd),
        `Error message must not contain the absolute working directory: "${error.message}"`,
      );
    }
  });

  test('path traversal error message is user-friendly without full path', () => {
    try {
      ensureCanonicalPathWithinWorkingDirectory(
        '../../etc/passwd',
        'target.filePath',
      );
      assert.fail('Expected ConfigurationError');
    } catch (error) {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /must stay within process\.cwd\(\)/);
      // Must NOT contain any absolute path segments
      assert.ok(
        !error.message.includes(path.sep + 'Users'),
        'Error must not expose filesystem paths',
      );
    }
  });
});
