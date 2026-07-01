/**
 * Canonical serialization for ledger records.
 *
 * The hash covers a stable, order-independent representation of the record's business
 * fields, so re-serializing the same logical record always yields the same string
 * regardless of key insertion order. We use JSON with recursively sorted object keys.
 *
 * IMPORTANT: the set and meaning of fields hashed here is a permanent contract — changing
 * it would invalidate every previously stored hash. See LedgerRecord below.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function sortValue(value: CanonicalValue): CanonicalValue {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue(value[key] as CanonicalValue);
    }
    return out;
  }
  return value;
}

/**
 * Produce the canonical string for a record. Keys are sorted recursively; `undefined`
 * fields are omitted by JSON.stringify, so callers should use `null` for absent values.
 */
export function canonicalize(record: CanonicalValue): string {
  return JSON.stringify(sortValue(record));
}
