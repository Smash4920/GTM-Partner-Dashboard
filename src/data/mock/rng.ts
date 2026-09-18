/** Deterministic PRNG (mulberry32) so the mock book of business is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

export function chance(rand: () => number, probability: number): boolean {
  return rand() < probability;
}

export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Amount between min and max, skewed low: more small deals than big ones. */
export function skewAmount(rand: () => number, min: number, max: number): number {
  return Math.round(min + (max - min) * rand() * rand());
}

export function weightedPick<T>(
  rand: () => number,
  entries: readonly (readonly [T, number])[],
): T {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  let roll = rand() * total;
  for (const [item, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return entries[entries.length - 1]![0];
}
