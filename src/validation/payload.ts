import { ValidationError } from '../errors/index.js';
import {
  computeUtf8ByteLength,
  estimateJsonStringBytes,
} from '../storage/backend/encoding.js';
import type { RecordPayload, SupportedNestedValue } from '../types.js';

export const DEFAULT_MAX_PAYLOAD_DEPTH = 64;
export const DEFAULT_MAX_PAYLOAD_KEY_BYTES = 1024;
export const DEFAULT_MAX_PAYLOAD_STRING_BYTES = 65535;
export const DEFAULT_MAX_PAYLOAD_KEYS_PER_OBJECT = 256;
export const DEFAULT_MAX_PAYLOAD_KEYS_TOTAL = 4096;
export const DEFAULT_MAX_PAYLOAD_TOTAL_BYTES = 1048576;

export interface ResolvedPayloadLimits {
  maxDepth: number;
  maxKeyBytes: number;
  maxStringBytes: number;
  maxKeysPerObject: number;
  maxTotalKeys: number;
  maxTotalBytes: number;
}

export const DEFAULT_PAYLOAD_LIMITS: Readonly<ResolvedPayloadLimits> = {
  maxDepth: DEFAULT_MAX_PAYLOAD_DEPTH,
  maxKeyBytes: DEFAULT_MAX_PAYLOAD_KEY_BYTES,
  maxStringBytes: DEFAULT_MAX_PAYLOAD_STRING_BYTES,
  maxKeysPerObject: DEFAULT_MAX_PAYLOAD_KEYS_PER_OBJECT,
  maxTotalKeys: DEFAULT_MAX_PAYLOAD_KEYS_TOTAL,
  maxTotalBytes: DEFAULT_MAX_PAYLOAD_TOTAL_BYTES,
};

// JSON-aware byte estimates for non-string primitives.
const NULL_ESTIMATION_BYTES = 4; // "null"  = 4 bytes

// JSON structural overhead constants for size estimation.
const JSON_KEY_COLON_OVERHEAD = 1; // 1 colon per key (quotes handled by estimateJsonStringBytes)
const JSON_OBJECT_BRACE_OVERHEAD = 2; // {} per object
// Root [key, {"payload": ...}] wrapper: [ + , + {"payload": + } + ] = 15 bytes
const JSON_ROOT_WRAPPER_OVERHEAD = 15;

export interface PayloadValidationResult {
  payload: RecordPayload;
  sizeBytes: number;
}

interface PayloadValidationState {
  activePath: WeakSet<object>;
  totalKeyCount: number;
  totalValidationBytes: number;
  limits: ResolvedPayloadLimits;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  const objectValue: object = value;
  const prototype: unknown = Object.getPrototypeOf(objectValue);
  return prototype === Object.prototype || prototype === null;
};

const addValidationBytes = (
  state: PayloadValidationState,
  bytes: number,
): void => {
  state.totalValidationBytes += bytes;
  if (state.totalValidationBytes > state.limits.maxTotalBytes) {
    throw new ValidationError(
      `Payload aggregate validation bytes must be <= ${state.limits.maxTotalBytes}.`,
    );
  }
};

const validatePayloadKey = (
  key: string,
  state: PayloadValidationState,
): void => {
  if (key.trim().length === 0) {
    throw new ValidationError('Payload keys must be non-empty strings.');
  }

  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new ValidationError(
      `Payload key "${key}" is reserved and not allowed.`,
    );
  }

  const keyBytes = computeUtf8ByteLength(key);
  if (keyBytes > state.limits.maxKeyBytes) {
    throw new ValidationError(
      `Payload key UTF-8 byte length must be <= ${state.limits.maxKeyBytes}.`,
    );
  }

  state.totalKeyCount += 1;
  if (state.totalKeyCount > state.limits.maxTotalKeys) {
    throw new ValidationError(
      `Payload total key count must be <= ${state.limits.maxTotalKeys}.`,
    );
  }

  // Add key as JSON string (with escaping + quotes) plus colon.
  addValidationBytes(
    state,
    estimateJsonStringBytes(key) + JSON_KEY_COLON_OVERHEAD,
  );
};

export const deepFreezePayload = (payload: RecordPayload): RecordPayload => {
  Object.freeze(payload);

  for (const value of Object.values(payload)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Object.isFrozen(value)
    ) {
      deepFreezePayload(value as RecordPayload);
    }
  }

  return payload;
};

const validateAndCloneValue = (
  value: unknown,
  depth: number,
  state: PayloadValidationState,
): SupportedNestedValue => {
  if (value === null) {
    addValidationBytes(state, NULL_ESTIMATION_BYTES);
    return null;
  }
  if (typeof value === 'string') {
    const stringBytes = computeUtf8ByteLength(value);
    if (stringBytes > state.limits.maxStringBytes) {
      throw new ValidationError(
        `Payload string UTF-8 byte length must be <= ${state.limits.maxStringBytes}.`,
      );
    }
    addValidationBytes(state, estimateJsonStringBytes(value));
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Payload number values must be finite.');
    }
    addValidationBytes(state, String(value).length);
    return value;
  }
  if (typeof value === 'boolean') {
    addValidationBytes(state, value ? 4 : 5);
    return value;
  }
  if (typeof value === 'bigint') {
    throw new ValidationError('Payload bigint values are not supported.');
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      throw new ValidationError('Payload arrays are not supported.');
    }
    if (!isPlainObject(value)) {
      throw new ValidationError('Payload values must be plain objects.');
    }
    return validateAndClonePayloadObject(value, depth + 1, state);
  }
  throw new ValidationError(
    'Payload values must be string | number | boolean | null or nested object.',
  );
};

const validateAndClonePayloadObject = (
  payloadObject: Record<string, unknown>,
  depth: number,
  state: PayloadValidationState,
): RecordPayload => {
  const objectLevel = depth + 1;
  if (objectLevel > state.limits.maxDepth) {
    throw new ValidationError(
      `Payload nesting depth must be <= ${state.limits.maxDepth}.`,
    );
  }

  if (state.activePath.has(payloadObject)) {
    throw new ValidationError('Circular payload references are not supported.');
  }

  const entries = Object.entries(payloadObject);
  if (entries.length > state.limits.maxKeysPerObject) {
    throw new ValidationError(
      `Payload object key count must be <= ${state.limits.maxKeysPerObject}.`,
    );
  }

  state.activePath.add(payloadObject);

  // JSON structural overhead: 2 bytes for braces + (N-1) bytes for comma separators.
  const entryCount = entries.length;
  const commaBytes = entryCount > 1 ? entryCount - 1 : 0;
  addValidationBytes(state, JSON_OBJECT_BRACE_OVERHEAD + commaBytes);

  const copied: RecordPayload = {};
  for (const [key, value] of entries) {
    validatePayloadKey(key, state);
    copied[key] = validateAndCloneValue(value, depth, state);
  }

  state.activePath.delete(payloadObject);
  return copied;
};

export const validateAndNormalizePayload = (
  payload: unknown,
  limits: ResolvedPayloadLimits = DEFAULT_PAYLOAD_LIMITS,
): PayloadValidationResult => {
  if (!isPlainObject(payload)) {
    throw new ValidationError('payload must be a non-null plain object.');
  }

  const state: PayloadValidationState = {
    activePath: new WeakSet<object>(),
    totalKeyCount: 0,
    totalValidationBytes: 0,
    limits,
  };
  const cloned = validateAndClonePayloadObject(payload, 0, state);
  const sizeBytes = state.totalValidationBytes + JSON_ROOT_WRAPPER_OVERHEAD;
  return { payload: cloned, sizeBytes };
};
