import { BehaviorSubject, firstValueFrom, of, Subject } from "rxjs";
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

  it("keeps a loaded value after the last subscriber leaves", async () => {
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

    expect(res1).toBe(6);
    expect(res2).toBe(6);

    // the first load completed, so the second subscriber is served without one
    expect(calls).toBe(1);
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

  describe("project", () => {
    const tick = () => new Promise((r) => setTimeout(r, 5));

    const setup = (options?: { cacheSize?: number; refCount?: boolean }) => {
      const calls: number[] = [];
      const factory = statefulObservableFactory<number, number>({
        loader: (id) => {
          calls.push(id);
          return Promise.resolve(id * 10);
        },
        cacheKey: (i) => [i],
        ...options,
      });
      return { calls, factory };
    };

    it("projections with the same key share one entry with get", async () => {
      const { calls, factory } = setup();
      const projection1$ = factory.project(new BehaviorSubject(1));
      const projection2$ = factory.project(new BehaviorSubject(1));
      const instance = factory.get(1);
      const seen1: number[] = [];
      const seen2: number[] = [];
      const seen3: number[] = [];
      const subscriptions = [
        projection1$.subscribe((v) => seen1.push(v)),
        projection2$.subscribe((v) => seen2.push(v)),
        instance.subscribe((v) => seen3.push(v)),
      ];
      await tick();

      expect(calls).toEqual([1]);
      expect(seen1).toEqual([10]);
      expect(seen2).toEqual([10]);
      expect(seen3).toEqual([10]);
      expect(factory.get(1)).toBe(instance);
      subscriptions.forEach((s) => s.unsubscribe());
    });

    it.each(["projection1$", "projection2$", "instance1", "instance2"])(
      "reload on %s reloads every reference to the entry",
      async (reloaded) => {
        const { calls, factory } = setup();
        const references = {
          projection1$: factory.project(new BehaviorSubject(1)),
          projection2$: factory.project(new BehaviorSubject(1)),
          instance1: factory.get(1),
          instance2: factory.get(1),
        };
        const seen: Record<string, number[]> = {};
        const subscriptions = Object.entries(references).map(([name, ref]) => {
          seen[name] = [];
          return ref.subscribe((v) => seen[name].push(v));
        });
        await tick();

        references[reloaded as keyof typeof references].reload();
        await tick();

        expect(calls).toEqual([1, 1]);
        Object.keys(references).forEach((name) =>
          expect(seen[name]).toEqual([10, 10]),
        );
        subscriptions.forEach((s) => s.unsubscribe());
      },
    );

    it("makes one request for concurrent projections of one key", async () => {
      const { calls, factory } = setup();
      const input$ = new Subject<number>();
      const a = factory.project(input$).subscribe(() => {});
      const b = factory.project(input$).subscribe(() => {});

      input$.next(1);
      await tick();

      expect(calls).toEqual([1]);
      a.unsubscribe();
      b.unsubscribe();
    });

    it("switches to the entry of each emitted value", async () => {
      const { calls, factory } = setup({ refCount: false });
      const input$ = new Subject<number>();
      const values: number[] = [];
      const subscription = factory
        .project(input$)
        .subscribe((v) => values.push(v));

      input$.next(1);
      await tick();
      input$.next(2);
      await tick();
      input$.next(1);
      await tick();

      expect(values).toEqual([10, 20, 10]);
      expect(calls).toEqual([1, 2]);
      subscription.unsubscribe();
    });

    it("serves a loaded key again without a request when nobody holds it and refCount is true", async () => {
      const { calls, factory } = setup();

      await firstValueFrom(factory.project(of(1)).value$);
      await firstValueFrom(factory.project(of(1)).value$);

      expect(calls).toEqual([1]);
    });

    it("serves a kept key synchronously, without pending, with refCount false", async () => {
      const { calls, factory } = setup({ refCount: false });
      await firstValueFrom(factory.project(of(1)).value$);

      const events: boolean[] = [];
      const values: number[] = [];
      const stream = factory.project(of(1));
      const pending = stream.pending$.subscribe((p) => events.push(p));
      const value = stream.value$.subscribe((v) => values.push(v));
      pending.unsubscribe();
      value.unsubscribe();

      expect(values).toEqual([10]);
      expect(events).toEqual([false]);
      expect(calls).toEqual([1]);
    });

    it("keeps falsy results with refCount false", async () => {
      const calls: number[] = [];
      const factory = statefulObservableFactory<number, number>({
        loader: (id) => {
          calls.push(id);
          return Promise.resolve(0);
        },
        refCount: false,
      });

      expect(await firstValueFrom(factory.project(of(1)).value$)).toBe(0);
      expect(await firstValueFrom(factory.project(of(1)).value$)).toBe(0);
      expect(calls).toEqual([1]);
    });

    it("evicts the least recently used entry at cacheSize", async () => {
      const { calls, factory } = setup({ cacheSize: 2, refCount: false });
      const input$ = new Subject<number>();
      const subscription = factory.project(input$).subscribe(() => {});

      for (const id of [1, 2, 1, 3, 2]) {
        input$.next(id);
        await tick();
      }

      // 1, 2 loaded; 1 hit; 3 evicts 2; 2 loaded again
      expect(calls).toEqual([1, 2, 3, 2]);
      subscription.unsubscribe();
    });

    it("never evicts the entry a projection shows", async () => {
      const { calls, factory } = setup({ cacheSize: 1, refCount: false });
      const input$ = new Subject<number>();
      const a = factory.project(input$).subscribe(() => {});
      const b = factory.project(input$).subscribe(() => {});

      input$.next(1);
      await tick();
      // the key is held by both projections, so it stays and is not loaded twice
      expect(factory.get(1)).toBe(factory.get(1));
      expect(calls).toEqual([1]);
      a.unsubscribe();
      b.unsubscribe();
    });

    it("reset(false) drops entries nobody shows and keeps shown ones", async () => {
      const { calls, factory } = setup({ refCount: false });
      const shown = factory.project(of(1)).subscribe(() => {});
      await firstValueFrom(factory.project(of(2)).value$);
      await tick();

      factory.reset(false);
      await firstValueFrom(factory.project(of(1)).value$);
      await firstValueFrom(factory.project(of(2)).value$);

      // 1 is still shown and kept; 2 was dropped and loaded again
      expect(calls).toEqual([1, 2, 2]);
      shown.unsubscribe();
    });

    it("reset(true) completes streams made with project", () => {
      const { factory } = setup();
      let completed = 0;
      const subscription = factory
        .project(new Subject<number>())
        .subscribe({ complete: () => completed++ });

      factory.reset(true);

      expect(completed).toBe(1);
      subscription.unsubscribe();
    });

    it("reloads with the factory", async () => {
      const { calls, factory } = setup();
      const values: number[] = [];
      const subscription = factory
        .project(of(1))
        .subscribe((v) => values.push(v));
      await tick();

      factory.reload();
      await tick();

      expect(calls).toEqual([1, 1]);
      expect(values).toEqual([10, 10]);
      subscription.unsubscribe();
    });

    it("reload does nothing before the input has emitted", () => {
      const { calls, factory } = setup();
      const stream = factory.project(new Subject<number>());

      stream.reload();

      expect(calls).toEqual([]);
    });

    it("loads nothing while active is false, and loads once it turns true", async () => {
      const active$ = new BehaviorSubject(false);
      const calls: number[] = [];
      const factory = statefulObservableFactory<number, number>({
        loader: (id) => {
          calls.push(id);
          return Promise.resolve(id);
        },
        active: active$,
      });
      const values: number[] = [];
      const subscription = factory
        .project(of(1))
        .subscribe((v) => values.push(v));

      await tick();
      expect(calls).toEqual([]);

      active$.next(true);
      await tick();
      expect(calls).toEqual([1]);
      expect(values).toEqual([1]);
      subscription.unsubscribe();
    });

    it("turns a throwing loader into an error for that input only", async () => {
      const factory = statefulObservableFactory<number, number>({
        loader: (id) => {
          if (id === 1) throw new Error("boom");
          return Promise.resolve(id);
        },
      });
      const input$ = new Subject<number>();
      const stream = factory.project(input$);
      const errors: unknown[] = [];
      const values: number[] = [];
      const e = stream.error$.subscribe((x) => x && errors.push(x));
      const v = stream.value$.subscribe((x) => values.push(x));

      input$.next(1);
      await tick();
      input$.next(2);
      await tick();

      expect(errors.length).toBe(1);
      expect(values).toEqual([2]);
      e.unsubscribe();
      v.unsubscribe();
    });

    it("turns a throwing cacheKey into an error for that input only", async () => {
      const factory = statefulObservableFactory<number, number>({
        loader: (id) => Promise.resolve(id),
        cacheKey: (id) => {
          if (id === 1) throw new Error("bad key");
          return [id];
        },
      });
      const input$ = new Subject<number>();
      const stream = factory.project(input$);
      const errors: unknown[] = [];
      const values: number[] = [];
      const e = stream.error$.subscribe((x) => x && errors.push(x));
      const v = stream.value$.subscribe((x) => values.push(x));

      input$.next(1);
      await tick();
      input$.next(2);
      await tick();

      expect(errors.length).toBe(1);
      expect(values).toEqual([2]);
      e.unsubscribe();
      v.unsubscribe();
    });

    it("an error$ subscriber on the projection silences the unhandled-error log", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const factory = statefulObservableFactory<number, number>({
        loader: () => Promise.reject(new Error("boom")),
      });

      const handled = factory.project(of(1));
      const errors: unknown[] = [];
      const e = handled.error$.subscribe((x) => x && errors.push(x));
      const v = handled.value$.subscribe(() => {});
      await tick();
      expect(errors.length).toBe(1);
      expect(logged).not.toHaveBeenCalled();
      e.unsubscribe();
      v.unsubscribe();

      const unhandled = factory.project(of(2)).value$.subscribe(() => {});
      await tick();
      expect(logged).toHaveBeenCalled();
      unhandled.unsubscribe();
      logged.mockRestore();
    });
  });

  describe("releasing removed entries", () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const setup = (refCount: boolean) => {
      const active = new BehaviorSubject(true);
      const loaders = new Map<number, Subject<number>>();
      const factory = statefulObservableFactory<number, number>({
        loader: (id) => {
          const source = new Subject<number>();
          loaders.set(id, source);
          return source;
        },
        active,
        refCount,
        cacheSize: 1,
      });
      return { active, loaders, factory };
    };

    it("unsubscribes the loader and active of an evicted entry with refCount false", async () => {
      const { active, loaders, factory } = setup(false);
      factory
        .get(1)
        .subscribe(() => {})
        .unsubscribe();
      // kept while cached
      expect(loaders.get(1)?.observed).toBe(true);
      await tick();

      factory.get(2); // evicts 1
      await Promise.resolve(); // a loader is released a microtask later

      expect(loaders.get(1)?.observed).toBe(false);
      expect(active.observers.length).toBe(0);
    });

    it("unsubscribes entries dropped by reset(false) with refCount false", async () => {
      const { active, loaders, factory } = setup(false);
      factory
        .get(1)
        .subscribe(() => {})
        .unsubscribe();
      await tick();

      factory.reset(false);
      await Promise.resolve(); // a loader is released a microtask later

      expect(loaders.get(1)?.observed).toBe(false);
      expect(active.observers.length).toBe(0);
    });

    it("unsubscribes everything on reset(true) with refCount false", async () => {
      const { active, loaders, factory } = setup(false);
      let completed = false;
      factory.get(1).subscribe({ complete: () => (completed = true) });

      factory.reset(true);
      await Promise.resolve(); // a loader is released a microtask later

      expect(completed).toBe(true);
      expect(loaders.get(1)?.observed).toBe(false);
      expect(active.observers.length).toBe(0);
    });

    it("a kept reference to a removed entry does not connect again with refCount false", async () => {
      const { active, factory } = setup(false);
      const held = factory.get(1);
      await tick();
      factory.get(2); // evicts 1, never subscribed
      factory
        .get(2)
        .subscribe(() => {})
        .unsubscribe();
      factory.reset(false);

      let completed = false;
      held.subscribe({ complete: () => (completed = true) });

      expect(completed).toBe(true);
      expect(active.observers.length).toBe(0);
    });

    it("a kept reference to an evicted entry still works with refCount true", async () => {
      const { loaders, factory } = setup(true);
      const held = factory.get(1);
      await tick();
      factory.get(2); // evicts 1

      const values: number[] = [];
      const subscription = held.value$.subscribe((v) => values.push(v));
      loaders.get(1)?.next(10);
      subscription.unsubscribe();
      await Promise.resolve(); // a loader is released a microtask later

      expect(values).toEqual([10]);
      expect(loaders.get(1)?.observed).toBe(false);
    });
  });
});
