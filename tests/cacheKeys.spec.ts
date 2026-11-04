import { BehaviorSubject, defer, of, Subject } from "rxjs";
import { createCache, toCacheKey } from "../src/cache";
import { statefulObservableFactory } from "../src/factory";
import { statefulObservable } from "../src/statefulObservable";

const countingLoader = <I, R>(project: (input: I) => R) => {
  const calls: I[] = [];
  const loader = (input: I) =>
    defer(() => {
      calls.push(input);
      return of(project(input));
    });
  return { calls, loader };
};

describe("cache keys", () => {
  it("toCacheKey: empty parts mean no caching", () => {
    expect(toCacheKey([])).toBeNull();
  });

  it("toCacheKey: keeps types and part boundaries apart", () => {
    expect(toCacheKey([1])).not.toBe(toCacheKey(["1"]));
    expect(toCacheKey(["a|b"])).not.toBe(toCacheKey(["a", "b"]));
    expect(toCacheKey([{ id: 1 }])).not.toBe(toCacheKey([{ id: 2 }]));
    expect(toCacheKey([{ id: 1 }])).toBe(toCacheKey([{ id: 1 }]));
    expect(toCacheKey([1n])).not.toBe(toCacheKey(["1"]));
  });

  it("result cache: 1 and '1' are different keys", () => {
    const { calls, loader } = countingLoader((id: number | string) => typeof id);
    const input = new Subject<number | string>();
    const stream = statefulObservable({ input, loader, cacheKey: (id) => [id] });
    const values: string[] = [];
    const sub = stream.subscribe((v) => values.push(v));

    input.next(1);
    input.next("1");

    expect(values).toEqual(["number", "string"]);
    expect(calls).toEqual([1, "1"]);
    sub.unsubscribe();
  });

  it("result cache: a separator inside a part does not collide", () => {
    const { calls, loader } = countingLoader((parts: string[]) => parts.length);
    const input = new Subject<string[]>();
    const stream = statefulObservable({ input, loader, cacheKey: (p) => p });
    const values: number[] = [];
    const sub = stream.subscribe((v) => values.push(v));

    input.next(["a|b"]);
    input.next(["a", "b"]);

    expect(values).toEqual([1, 2]);
    expect(calls.length).toBe(2);
    sub.unsubscribe();
  });

  it("result cache: an empty key still skips caching", () => {
    const { calls, loader } = countingLoader((id: number) => id);
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({ input, loader, cacheKey: () => [] });
    const sub = stream.subscribe(() => {});

    input.next(2);
    input.next(1);

    expect(calls).toEqual([1, 2, 1]);
    sub.unsubscribe();
  });
});

describe("falsy results in the result cache", () => {
  it.each([0, "", false, null])("serves %j from the cache", (falsy) => {
    const { calls, loader } = countingLoader((id: number) =>
      id === 1 ? falsy : "other",
    );
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({ input, loader, cacheKey: (id) => [id] });
    const values: unknown[] = [];
    const sub = stream.subscribe((v) => values.push(v));

    input.next(2);
    input.next(1);

    expect(calls).toEqual([1, 2]);
    expect(values).toEqual([falsy, "other", falsy]);
    sub.unsubscribe();
  });

  it("createCache.lookup tells a stored falsy value from a miss", () => {
    const cache = createCache<number>(2);
    cache.set("zero", 0);
    expect(cache.lookup("zero")).toEqual({ hit: true, value: 0 });
    expect(cache.lookup("missing")).toEqual({ hit: false });
  });
});

describe("null results", () => {
  it("a loader that returns null delivers null instead of crashing", () => {
    const stream = statefulObservable({ loader: () => of(null) });
    const values: unknown[] = [];
    const sub = stream.subscribe((v) => values.push(v));

    expect(values).toEqual([null]);
    sub.unsubscribe();
  });
});

describe("factory keys", () => {
  it("object inputs without cacheKey get one stream per distinct object", () => {
    const { loader } = countingLoader((q: { id: number }) => q.id * 10);
    const factory = statefulObservableFactory({ loader });

    const first = factory.get({ id: 1 });
    const second = factory.get({ id: 2 });
    const values: number[] = [];
    const subs = [first, second].map((s) => s.subscribe((v) => values.push(v)));

    expect(first).not.toBe(second);
    expect(values).toEqual([10, 20]);
    // equal objects built separately still share a stream
    expect(factory.get({ id: 1 })).toBe(first);
    subs.forEach((s) => s.unsubscribe());
  });
});

describe("factory with refCount: false", () => {
  it("reset(false) drops an entry once its consumers have left", () => {
    const { calls, loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, refCount: false });

    const stream = factory.get(1);
    stream.subscribe(() => {}).unsubscribe();
    factory.reset(false);

    expect(factory.get(1)).not.toBe(stream);
    expect(calls).toEqual([1]);
  });

  it("reset(false) keeps an entry that has a consumer", () => {
    const { loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, refCount: false });

    const stream = factory.get(1);
    const sub = stream.subscribe(() => {});
    factory.reset(false);

    expect(factory.get(1)).toBe(stream);
    sub.unsubscribe();
  });

  it("a kept entry serves a returning consumer without a new request", () => {
    const { calls, loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, refCount: false });

    factory.get(1).subscribe(() => {}).unsubscribe();
    const values: number[] = [];
    const sub = factory.get(1).subscribe((v) => values.push(v));

    expect(values).toEqual([1]);
    expect(calls).toEqual([1]);
    sub.unsubscribe();
  });
});

describe("factory eviction", () => {
  it("does not evict entries that have consumers", () => {
    const { calls, loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, cacheSize: 2 });

    // each stream is subscribed before the next `get`, as a rendered row would be
    const first = factory.get(1);
    const subs = [1, 2, 3].map((id) => factory.get(id).subscribe(() => {}));

    expect(factory.get(1)).toBe(first);
    expect(calls).toEqual([1, 2, 3]);
    subs.forEach((s) => s.unsubscribe());
  });

  it("keeps an entry that was created but not yet subscribed for one tick", () => {
    const { calls, loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, cacheSize: 2 });

    // a burst of `get` calls before any subscription, as in one render pass
    const first = factory.get(1);
    const subs = [2, 3].map((id) => factory.get(id).subscribe(() => {}));
    const late = first.subscribe(() => {});

    expect(factory.get(1)).toBe(first);
    expect(calls).toEqual([2, 3, 1]);
    [...subs, late].forEach((s) => s.unsubscribe());
  });

  it("evicts a never-subscribed entry after the tick", async () => {
    const { loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, cacheSize: 2 });

    const neverSubscribed = factory.get(1);
    await Promise.resolve();
    const subs = [2, 3].map((id) => factory.get(id).subscribe(() => {}));

    expect(factory.get(1)).not.toBe(neverSubscribed);
    subs.forEach((s) => s.unsubscribe());
  });

  it("still evicts idle entries, oldest first", async () => {
    const { loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, cacheSize: 2 });

    const idle = factory.get(1);
    idle.subscribe(() => {}).unsubscribe();
    await Promise.resolve(); // past the one-tick pin of a new entry
    const subs = [factory.get(2), factory.get(3)].map((s) =>
      s.subscribe(() => {}),
    );

    expect(factory.get(1)).not.toBe(idle);
    subs.forEach((s) => s.unsubscribe());
  });

  it("keeps a new entry when every older one has consumers", () => {
    const { loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, cacheSize: 1 });

    const sub = factory.get(1).subscribe(() => {});
    const second = factory.get(2);

    expect(factory.get(2)).toBe(second);
    sub.unsubscribe();
  });

  it("evicts entries over capacity once their consumers have left", async () => {
    const { loader } = countingLoader((id: number) => id);
    const factory = statefulObservableFactory({ loader, cacheSize: 1 });

    const first = factory.get(1);
    const sub = first.subscribe(() => {});
    factory.get(2).subscribe(() => {}).unsubscribe();
    sub.unsubscribe();
    await Promise.resolve(); // past the one-tick pin of new entries
    factory.get(3);

    expect(factory.get(1)).not.toBe(first);
  });
});
