import { firstValueFrom } from "rxjs";
import { take, toArray } from "rxjs/operators";
import { statefulObservableFactory } from "../src/factory";

describe("statefulObservableFactory", () => {
  it("reuses statefulObservable instances for the same key (single request)", async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id * 10);
      },
      cacheKey: (i) => [i],
    });

    const s1 = factory.get(1);
    const s2 = factory.get(1);

    // subscribe both - because of sharing there should be only one loader call
    const [v1, v2] = await Promise.all([
      firstValueFrom(s1.value$),
      firstValueFrom(s2.value$),
    ]);

    expect(v1).toBe(10);
    expect(v2).toBe(10);
    expect(calls).toBe(1);
  });

  it("cleanup on absent subscribers", async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id * 2);
      },
      cacheKey: (i) => [i],
    });

    const s1 = factory.get(3);

    const p1 = firstValueFrom(s1.value$.pipe(take(1)));

    // wait a tick for initial values to arrive
    const res1 = await p1;

    const p2 = firstValueFrom(s1.value$.pipe(take(1)));

    const res2 = await p2;

    // each stream emitted two values (initial + reload)
    expect(res1).toBe(6);
    expect(res2).toBe(6);

    // loader called once per initial subscription + once per reload per stream
    expect(calls).toBe(2);
  });

  it("reset(false) clears cached observables without subscribers", async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id + 100);
      },
      cacheKey: (i) => [i],
    });

    // initial subscription
    const s1 = factory.get(2);
    const v = await firstValueFrom(s1.value$);
    expect(v).toBe(102);

    // after firstValueFrom completes there are no active subscribers
    // reset only entries with no subscribers
    factory.reset(false);

    // getting again should create a fresh stream and trigger loader again
    const s2 = factory.get(2);
    const v2 = await firstValueFrom(s2.value$);
    expect(v2).toBe(102);
    expect(calls).toBe(2);
  });

  it("reset(false) keeps entries that still have subscribers", async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id + 100);
      },
      cacheKey: (i) => [i],
    });

    const subscribed = factory.get(1);
    const idle = factory.get(2);

    const values: number[] = [];
    const subscription = subscribed.subscribe((v) => values.push(v));
    await firstValueFrom(idle.value$); // subscribes and unsubscribes again
    await new Promise((r) => setTimeout(r, 5));
    expect(values).toEqual([101]);

    factory.reset(false);

    // the subscribed entry survives, the idle one is dropped
    expect(factory.get(1)).toBe(subscribed);
    expect(factory.get(2)).not.toBe(idle);

    // the surviving entry still serves its subscriber and is not refetched
    expect(calls).toBe(2);
    subscription.unsubscribe();
  });

  it("reset(false) drops an entry once its last subscriber has left", async () => {
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => Promise.resolve(id),
      cacheKey: (i) => [i],
    });

    const stream = factory.get(1);
    const first = stream.subscribe(() => {});
    const second = stream.subscribe(() => {});
    await new Promise((r) => setTimeout(r, 5));

    first.unsubscribe();
    factory.reset(false);
    expect(factory.get(1)).toBe(stream); // one subscriber is left

    second.unsubscribe();
    factory.reset(false);
    expect(factory.get(1)).not.toBe(stream); // none left
  });

  it("reset(true) completes existing subscribers and empties the cache", async () => {
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => Promise.resolve(id * 10),
      cacheKey: (i) => [i],
    });

    const stream = factory.get(1);
    const values: number[] = [];
    let completed = 0;
    const subscription = stream.subscribe({
      next: (v) => values.push(v),
      complete: () => completed++,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(values).toEqual([10]);
    expect(completed).toBe(0);

    factory.reset(true);

    expect(completed).toBe(1);
    expect(factory.get(1)).not.toBe(stream);
    subscription.unsubscribe();
  });

  it("reset(false) does not complete entries that have subscribers", async () => {
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => Promise.resolve(id),
      cacheKey: (i) => [i],
    });

    const stream = factory.get(1);
    let completed = 0;
    const subscription = stream.subscribe({ complete: () => completed++ });
    await new Promise((r) => setTimeout(r, 5));

    factory.reset(false);

    expect(completed).toBe(0);
    expect(factory.get(1)).toBe(stream);
    subscription.unsubscribe();
  });

  it("reload triggers reload on all cached observables", async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id * 2);
      },
      cacheKey: (i) => [i],
    });

    const s1 = factory.get(3);
    const s2 = factory.get(4);

    // collect two emissions: initial + after reload
    const p1 = firstValueFrom(s1.value$.pipe(take(2), toArray()));
    const p2 = firstValueFrom(s2.value$.pipe(take(2), toArray()));

    // wait a tick for initial values to arrive
    await Promise.all([firstValueFrom(s1.value$), firstValueFrom(s2.value$)]);

    // trigger reload for all cached streams
    factory.reload();

    const res = await Promise.all([p1, p2]);

    // each stream emitted two values (initial + reload)
    expect(res[0].length).toBe(2);
    expect(res[1].length).toBe(2);

    // loader called once per initial subscription + once per reload per stream
    expect(calls).toBe(4);
  });
});
