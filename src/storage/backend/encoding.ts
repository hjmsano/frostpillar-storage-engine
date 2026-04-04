import type { RecordPayload } from '../../types.js';

// ---------------------------------------------------------------------------
// P8: Platform-native UTF-8 byte length with JS fallback for browsers
// ---------------------------------------------------------------------------

const computeUtf8ByteLengthJs = (value: string): number => {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++; // skip low surrogate
      } else {
        // Lone high surrogate: Node.js encodes as 3-byte CESU-8 (not U+FFFD).
        // For JSON-serialized byte counts, use estimateJsonStringBytes() instead.
        bytes += 3;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate — same platform-dependent caveat as above.
      bytes += 3;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

const hasBuffer = typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function';

export const computeUtf8ByteLength: (value: string) => number = hasBuffer
  ? (value: string): number => Buffer.byteLength(value, 'utf8')
  : computeUtf8ByteLengthJs;

// ---------------------------------------------------------------------------
// P9: Structural size estimation — walk object tree without JSON.stringify
// ---------------------------------------------------------------------------

/**
 * Compute the UTF-8 byte length of a string as it would appear in JSON output
 * (i.e., with JSON escaping applied), INCLUDING the surrounding quotes.
 */
export const estimateJsonStringBytes = (value: string): number => {
  // 2 bytes for the surrounding quotes
  let bytes = 2;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // JSON.stringify escapes: " → \", \\ → \\, \n → \\n, \r → \\r, \t → \\t,
    // \b → \\b, \f → \\f, and U+0000–U+001F → \\uXXXX (6 chars)
    if (code === 0x22 || code === 0x5c) {
      // " or \ → 2 ASCII bytes
      bytes += 2;
    } else if (code <= 0x1f) {
      // Control characters: \b(8), \t(9), \n(10), \f(12), \r(13) → 2 bytes each
      // Others → \uXXXX → 6 bytes each
      if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
        bytes += 2;
      } else {
        bytes += 6;
      }
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++; // skip low surrogate
      } else {
        bytes += 6; // lone high surrogate → JSON.stringify emits \uDXXX (6 ASCII bytes)
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6; // lone low surrogate → JSON.stringify emits \uDXXX (6 ASCII bytes)
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

/**
 * Estimate the UTF-8 byte length of `JSON.stringify(value)` by walking the
 * object tree structurally. Does NOT call JSON.stringify.
 *
 * Supports: null, boolean, number, string, plain objects.
 * Arrays are NOT supported (payloads don't contain arrays).
 */
export const estimateObjectSizeBytes = (value: unknown): number => {
  if (value === null) {
    return 4; // "null"
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 4 : 5; // "true" / "false"
    case 'number':
      // Use String() for correctness with all number representations
      return String(value).length;
    case 'string':
      return estimateJsonStringBytes(value);
    case 'object': {
      const obj = value as Record<string, unknown>;
      let size = 2; // { }
      let visibleCount = 0;
      for (const k in obj) {
        if (!Object.hasOwn(obj, k)) continue;
        const v = obj[k];
        // JSON.stringify omits undefined values
        if (v === undefined) {
          continue;
        }
        if (visibleCount > 0) {
          size += 1; // comma
        }
        // key: quoted key string + colon
        size += estimateJsonStringBytes(k) + 1;
        // value
        size += estimateObjectSizeBytes(v);
        visibleCount++;
      }
      return size;
    }
    default:
      return 0;
  }
};

// ---------------------------------------------------------------------------
// P9: Refactored estimateRecordSizeBytes using structural estimation
// ---------------------------------------------------------------------------

// JSON_ROOT_WRAPPER_OVERHEAD = 15 matches: [key,{"payload":...}]
// Breakdown: [ + key + , + {"payload": + payload_json + } + ] = 1+1+10+1+1+1 = 15 overhead
const JSON_ROOT_WRAPPER_OVERHEAD = 15;

export const estimateRecordSizeBytes = (
  key: unknown,
  payload: RecordPayload,
): number => {
  return estimateObjectSizeBytes(key) + estimateObjectSizeBytes(payload) + JSON_ROOT_WRAPPER_OVERHEAD;
};

// ---------------------------------------------------------------------------
// P10: estimateKeySizeBytes
// ---------------------------------------------------------------------------

export const estimateKeySizeBytes = (key: unknown): number => {
  return estimateObjectSizeBytes(key);
};
