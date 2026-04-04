import { ConfigurationError } from '../../errors/index.js';
import type {
  AutoCommitConfig,
  CapacityConfig,
  DuplicateKeyPolicy,
} from '../../types.js';
import type { CapacityState, FileAutoCommitState } from '../backend/types.js';

const BYTE_SIZE_REGEX = /^(\d+)(B|KB|MB|GB)$/;
const BYTE_SIZE_MULTIPLIER: Readonly<Record<string, number>> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const FREQUENCY_REGEX = /^(\d+)(ms|s|m|h)$/;
const FREQUENCY_MULTIPLIER: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

const normalizeByteSizeInput = (value: CapacityConfig['maxSize']): number => {
  if (value === 'backendLimit') {
    throw new ConfigurationError(
      'capacity.maxSize "backendLimit" must be resolved before capacity parsing.',
    );
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigurationError(
        'capacity.maxSize must be a positive safe integer.',
      );
    }

    return value;
  }

  const matched = BYTE_SIZE_REGEX.exec(value);
  if (matched === null) {
    throw new ConfigurationError(
      'capacity.maxSize string must be <positive><B|KB|MB|GB>.',
    );
  }

  const amount = Number(matched[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ConfigurationError(
      'capacity.maxSize must be a positive safe integer.',
    );
  }

  const unit = matched[2];
  const multiplier = BYTE_SIZE_MULTIPLIER[unit];
  const total = amount * multiplier;

  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new ConfigurationError('capacity.maxSize exceeds safe integer range.');
  }

  return total;
};

export const parseCapacityConfig = (
  capacity?: CapacityConfig,
): CapacityState | null => {
  if (capacity === undefined) {
    return null;
  }

  const maxSizeBytes = normalizeByteSizeInput(capacity.maxSize);
  const policy = capacity.policy ?? 'strict';
  if (policy !== 'strict' && policy !== 'turnover') {
    throw new ConfigurationError('capacity.policy must be "strict" or "turnover".');
  }

  return { maxSizeBytes, policy };
};

const parseFrequencyString = (frequency: string): number => {
  const matched = FREQUENCY_REGEX.exec(frequency);
  if (matched === null) {
    throw new ConfigurationError(
      'autoCommit.frequency string must be one of: <positive>ms, <positive>s, <positive>m, <positive>h.',
    );
  }
  const amount = Number(matched[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ConfigurationError(
      'autoCommit.frequency string amount must be a positive safe integer.',
    );
  }

  const unit = matched[2];
  const multiplier = FREQUENCY_MULTIPLIER[unit];
  const intervalMs = amount * multiplier;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new ConfigurationError(
      'autoCommit.frequency exceeds safe integer range.',
    );
  }

  return intervalMs;
};

export const parseAutoCommitConfig = (
  autoCommit?: AutoCommitConfig,
): FileAutoCommitState => {
  if (autoCommit?.maxPendingBytes !== undefined) {
    if (
      !Number.isSafeInteger(autoCommit.maxPendingBytes) ||
      autoCommit.maxPendingBytes <= 0
    ) {
      throw new ConfigurationError(
        'autoCommit.maxPendingBytes must be a positive safe integer.',
      );
    }
  }

  const maxPendingBytes = autoCommit?.maxPendingBytes ?? null;
  const frequency = autoCommit?.frequency;
  if (frequency === undefined || frequency === 'immediate') {
    return { frequency: 'immediate', intervalMs: null, maxPendingBytes };
  }

  if (typeof frequency === 'number') {
    if (!Number.isSafeInteger(frequency) || frequency <= 0) {
      throw new ConfigurationError(
        'autoCommit.frequency number must be a positive safe integer.',
      );
    }

    return { frequency: 'scheduled', intervalMs: frequency, maxPendingBytes };
  }

  const intervalMs = parseFrequencyString(frequency);
  return { frequency: 'scheduled', intervalMs, maxPendingBytes };
};

const VALID_DUPLICATE_KEY_POLICIES: readonly DuplicateKeyPolicy[] = [
  'allow',
  'replace',
  'reject',
];

/** Validates and defaults `duplicateKeys` config. Safe for JS callers passing arbitrary values. */
export const parseDuplicateKeyConfig = (
  duplicateKeys?: DuplicateKeyPolicy,
): DuplicateKeyPolicy => {
  if (duplicateKeys === undefined) {
    return 'allow';
  }
  if (!VALID_DUPLICATE_KEY_POLICIES.includes(duplicateKeys)) {
    throw new ConfigurationError(
      'duplicateKeys must be "allow", "replace", or "reject".',
    );
  }
  return duplicateKeys;
};

