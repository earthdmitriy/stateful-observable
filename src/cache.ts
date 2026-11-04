export type CacheLookup<TValue> =
  { readonly hit: true; readonly value: TValue } | { readonly hit: false };

export type RollingCache<TValue> = {
  set(key: string, value: TValue): void;
  /** Distinguishes a stored falsy value (`0`, `""`, `false`, `null`) from a miss. */
  lookup(key: string): CacheLookup<TValue>;
  get(key: string): TValue | null;
  getAll(): TValue[];
  reset(filter?: (value: TValue) => boolean): void;
};

export type CreateCache<TValue> = (
  size: number,
  canEvict?: (value: TValue) => boolean,
) => RollingCache<TValue>;

// BigInt is not JSON-serializable; tag it so that 1n and "1" stay different keys
const keyReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? { $bigint: value.toString() } : value;

/**
 * Encodes key parts as a string. Unlike `join("|")`, it keeps types and part
 * boundaries apart (`1` vs `"1"`, `["a|b"]` vs `["a", "b"]`) and encodes
 * objects by content, so equal objects share a key and different ones do not.
 * Parts must be JSON-serializable (no cycles).
 */
export const encodeCacheKey = (parts: readonly unknown[]): string =>
  JSON.stringify(parts, keyReplacer);

/** Like `encodeCacheKey`, but an empty array means "do not cache" (`null`). */
export const toCacheKey = (parts: readonly unknown[]): string | null =>
  parts.length === 0 ? null : encodeCacheKey(parts);

// rolling cache using Map insertion order: least recently used first
export const createCache = <TValue>(
  size: number,
  canEvict: (value: TValue) => boolean = () => true,
): RollingCache<TValue> => {
  const capacity = Math.max(0, Math.floor(size));
  // values are boxed so that a stored `undefined` is not mistaken for a miss
  const map = new Map<string, { readonly value: TValue }>();

  const set = (key: string, value: TValue) => {
    if (capacity === 0) return;
    // If key exists, remove it so re-inserting moves it to the newest position
    if (map.has(key)) map.delete(key);
    map.set(key, { value });

    // Evict the oldest evictable entries until within capacity. The entry just
    // set is never evicted; when nothing else may go, the cache grows past its
    // capacity until entries become evictable again.
    while (map.size > capacity) {
      const victim = Array.from(map.entries()).find(
        ([candidateKey, candidate]) =>
          candidateKey !== key && canEvict(candidate.value),
      );
      if (!victim) break;
      map.delete(victim[0]);
    }
  };

  const lookup = (key: string): CacheLookup<TValue> => {
    const entry = map.get(key);
    if (!entry) return { hit: false };
    // move to newest position (LRU behavior)
    map.delete(key);
    map.set(key, entry);
    return { hit: true, value: entry.value };
  };

  const get = (key: string): TValue | null => {
    const result = lookup(key);
    return result.hit ? result.value : null;
  };

  const reset = (filter?: (value: TValue) => boolean) => {
    if (!filter) {
      map.clear();
      return;
    }
    for (const [key, entry] of map.entries()) {
      if (filter(entry.value)) {
        map.delete(key);
      }
    }
  };

  const getAll = (): TValue[] => {
    return Array.from(map.values(), (entry) => entry.value);
  };

  return { set, lookup, get, getAll, reset };
};
