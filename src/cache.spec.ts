import { createCache } from './cache';

describe('RollingCache / createCache (LRU)', () => {
  it('stores, retrieves and resets values', () => {
    const cache = createCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);

    cache.reset();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('evicts least-recently-used item when capacity exceeded', () => {
    const cache = createCache<string>(2);
    cache.set('a', 'A');
    cache.set('b', 'B');

    // current order: a (oldest), b (newest)
    // access 'a' to make it most-recently-used
    expect(cache.get('a')).toBe('A');

    // now order: b (oldest), a (newest)
    cache.set('c', 'C');

    // eviction should have removed 'b'
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
  });

  it('reinserting existing key makes it most-recently-used', () => {
    const cache = createCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // re-set 'a' moves it to most recent
    cache.set('a', 10);

    // insert new entry should evict 'b'
    cache.set('c', 3);

    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(10);
    expect(cache.get('c')).toBe(3);
  });

  it('size 0 cache does not store values', () => {
    const cache = createCache<any>(0);
    cache.set('x', 1);
    expect(cache.get('x')).toBeNull();
  });
});
