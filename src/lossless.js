/**
 * Lossless-JSON sanitizer for model-tool results.
 *
 * DSH validates that a tool's canonical output survives a JSON round-trip. A
 * value containing `undefined` object properties (or NaN/Infinity/function
 * values) is rejected with:
 *
 *   tool "..." returned invalid output: value is not lossless JSON
 *
 * Tool implementations naturally produce such values (`field: x || undefined`,
 * optional record fields), so every tool's final return is passed through
 * {@link toLosslessJson}:
 *
 *   - object properties whose value is `undefined`/function/symbol/BigInt are
 *     omitted;
 *   - array holes are preserved positionally as `null` (JSON has no holes);
 *   - NaN/Infinity become `null` (they have no JSON representation);
 *   - cycles become `null` instead of hanging.
 *
 * The data is acyclic in practice; the WeakSet is a cheap safety net.
 *
 * @module dsh-paper-deepread/lossless
 */

/**
 * Convert an arbitrary JS value into a lossless JSON value.
 * @param {unknown} value Candidate value.
 * @param {WeakSet<object>} [seen] Cycle guard for nested objects/arrays.
 * @returns {unknown} JSON-safe clone; `undefined` means "drop this property".
 */
export function toLosslessJson(value, seen = new WeakSet()) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    return undefined
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return null
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        return value.map(item => {
          const converted = toLosslessJson(item, seen)
          return converted === undefined ? null : converted
        })
      }
      const output = {}
      for (const [key, item] of Object.entries(value)) {
        const converted = toLosslessJson(item, seen)
        if (converted !== undefined) output[key] = converted
      }
      return output
    } finally {
      seen.delete(value)
    }
  }
  return undefined
}

/**
 * Canonical value for a tool implementation's `execute` return.
 * Tool results are always objects; an empty object is a safer fallback than
 * `null` when the implementation returned `undefined` by mistake.
 * @param {unknown} value Raw tool value.
 * @returns {object} Lossless JSON value.
 */
export function losslessToolResult(value) {
  const converted = toLosslessJson(value)
  return converted === undefined ? {} : converted
}
