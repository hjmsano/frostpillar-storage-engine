import path from 'node:path';
import { fileURLToPath } from 'node:url';

import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const typeScriptFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

const toTypeScriptScope = (config) => {
  return {
    ...config,
    files: Array.isArray(config.files) ? config.files : typeScriptFiles,
  };
};

const recommendedTypeCheckedConfigs =
  tseslint.configs.recommendedTypeChecked.map(toTypeScriptScope);
const stylisticTypeCheckedConfigs =
  tseslint.configs.stylisticTypeChecked.map(toTypeScriptScope);
const eslintRecommendedConfig = {
  ...eslint.configs.recommended,
  files: typeScriptFiles,
};

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '_OLD_/**', 'tests/.tmp/**'],
  },
  eslintRecommendedConfig,
  ...recommendedTypeCheckedConfigs,
  ...stylisticTypeCheckedConfigs,
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
    },
    rules: {
      // off: codebase uses { [key in string]: T } mapped-type syntax which
      // is not equivalent to Record<K, V> — the rule would incorrectly flag it.
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/only-throw-error': 'error',
      // off: the codebase does not use || for nullable fallbacks; enabling this
      // would produce false positives on boolean-guard expressions.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // off: optional-chain auto-fixes can break type-narrowing in conditional
      // chains where the intermediate value participates in a type guard.
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'max-lines': [
        'warn',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        {
          max: 50,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  eslintConfigPrettier,
);

export default eslintConfig;
