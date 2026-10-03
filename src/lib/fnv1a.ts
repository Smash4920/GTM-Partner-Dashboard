/**
 * Deterministic 32-bit FNV-1a over UTF-16 code units, not Unicode code points.
 * An explicit state continues a fold (including zero); omitted uses the FNV
 * offset basis. This is a grouping/mixing primitive, not cryptographic armor.
 */
export function fnv1a(text: string, state = 0x811c9dc5): number {
  let hash = state;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
