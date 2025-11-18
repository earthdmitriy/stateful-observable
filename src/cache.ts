export type RollingCache<TValue> = {
    set(key:string, value: TValue): void;
    get(key: string): TValue | null;
    reset(): void;
}

export type CreateCache<TValue> = (size: number) => RollingCache<TValue>

// simple rolling (FIFO) cache implementation using Map to preserve insertion order
export const createCache = <TValue>(size: number): RollingCache<TValue> => {
    const capacity = Math.max(0, Math.floor(size));
    const map = new Map<string, TValue>();

    const set = (key: string, value: TValue) => {
        if (capacity === 0) return;
        // If key exists, remove it so re-inserting moves it to the newest position
        if (map.has(key)) map.delete(key);
        map.set(key, value);

        // Evict oldest entries until within capacity
        while (map.size > capacity) {
            const oldestKey = map.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            map.delete(oldestKey);
        }
    };

    const get = (key: string): TValue | null => {
            const v = map.get(key);
            if (v === undefined) return null;
            // move to newest position (LRU behavior)
            map.delete(key);
            map.set(key, v);
            return v;
    };

    const reset = () => map.clear();

    return { set, get, reset };
};