import { BehaviorSubject, firstValueFrom, Observable, Subject } from "rxjs";
import { statefulObservableBatchFactory } from "../src/batchFactory";
import { statefulObservableFactory } from "../src/factory";

/**
 * Factory entries cancel a load in flight when their last consumer leaves
 * (`refCount: true`) and keep a load that completed, so a consumer that comes
 * back is served without a new request. See docs/adr.md, "Keep settled values
 * in factory entries".
 */

/** A loader whose requests stay pending until settled by hand. */
const controlledLoader = () => {
  const requests: string[] = [];
  const cancelled: string[] = [];
  const responses: {
    readonly id: string;
    readonly response: Subject<string>;
  }[] = [];
  const loader = (id: string): Observable<string> =>
    new Observable<string>((subscriber) => {
      requests.push(id);
      const response = new Subject<string>();
      responses.push({ id, response });
      let settled = false;
      const subscription = response.subscribe({
        next: (value) => subscriber.next(value),
        error: (error: unknown) => {
          settled = true;
          subscriber.error(error);
        },
        complete: () => {
          settled = true;
          subscriber.complete();
        },
      });
      return () => {
        subscription.unsubscribe();
        if (!settled) cancelled.push(id);
      };
    });
  /** The latest request for `id`. */
  const latest = (id: string) =>
    responses.filter((r) => r.id === id).at(-1)?.response;
  const settle = (id: string, value = `value ${id}`) => {
    latest(id)?.next(value);
    latest(id)?.complete();
  };
  return { requests, cancelled, responses, loader, latest, settle };
};

/** A loader is released a microtask after its last consumer leaves. */
const released = () => Promise.resolve();

describe("statefulObservableFactory: cancel if pending, keep if settled", () => {
  it("cancels an in-flight request when the last consumer leaves", async () => {
    const { cancelled, loader } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    await released();

    expect(cancelled).toEqual(["a"]);
  });

  it("serves a settled value to a returning consumer without a new request", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const first = factory.get("a").subscribe(() => {});
    settle("a");
    first.unsubscribe();

    const values: string[] = [];
    const pending: boolean[] = [];
    const stream = factory.get("a");
    const second = stream.subscribe((v) => values.push(v));
    const pendingSubscription = stream.pending$.subscribe((p) =>
      pending.push(p),
    );

    expect(requests).toEqual(["a"]);
    expect(values).toEqual(["value a"]);
    expect(pending).toEqual([false]); // served synchronously
    second.unsubscribe();
    pendingSubscription.unsubscribe();
  });

  it("keeps the value for a consumer that leaves inside next (firstValueFrom)", async () => {
    let calls = 0;
    const factory = statefulObservableFactory({
      loader: (id: string) => {
        calls++;
        return Promise.resolve(`value ${id}`);
      },
    });

    await firstValueFrom(factory.get("a").value$);
    await firstValueFrom(factory.get("a").value$);

    expect(calls).toBe(1);
  });

  it("project: switching away before the read settles cancels it (B1)", async () => {
    const { requests, cancelled, loader } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const selected$ = new Subject<string>();

    const subscription = factory.project(selected$).subscribe(() => {});
    selected$.next("a");
    selected$.next("b");
    await released();

    expect(requests).toEqual(["a", "b"]);
    expect(cancelled).toEqual(["a"]);
    subscription.unsubscribe();
  });

  it("project: coming back to a settled key makes no new request (C3)", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const selected$ = new Subject<string>();

    const values: string[] = [];
    const subscription = factory
      .project(selected$)
      .subscribe((v) => values.push(v));
    selected$.next("a");
    settle("a");
    selected$.next("b");
    selected$.next("a");

    expect(requests).toEqual(["a", "b"]);
    expect(values).toEqual(["value a", "value a"]);
    subscription.unsubscribe();
  });

  it("navigating away and back: cancels the pending key, keeps the settled one", async () => {
    const { requests, cancelled, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const a = factory.get("a").subscribe(() => {});
    settle("a");
    a.unsubscribe();
    factory
      .get("b")
      .subscribe(() => {})
      .unsubscribe();
    await released();

    expect(cancelled).toEqual(["b"]);

    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    factory
      .get("b")
      .subscribe(() => {})
      .unsubscribe();
    expect(requests).toEqual(["a", "b", "b"]);
  });

  it("loads again when the loader did not complete (a stream)", () => {
    const { requests, loader, latest } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const first = factory.get("a").subscribe(() => {});
    latest("a")?.next("tick 1");
    first.unsubscribe();
    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();

    expect(requests).toEqual(["a", "a"]);
  });

  it("keeps a load that completes in the same tick its consumer left", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    settle("a"); // before the microtask that releases the request
    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();

    expect(requests).toEqual(["a"]);
  });

  it("does not keep errors", () => {
    const { requests, loader, latest } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const first = factory.get("a").subscribe({ error: () => {} });
    latest("a")?.error("boom");
    first.unsubscribe();
    factory
      .get("a")
      .subscribe({ error: () => {} })
      .unsubscribe();

    expect(requests).toEqual(["a", "a"]);
  });

  it("reload() drops the kept value, also with no subscribers", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const stream = factory.get("a");
    const first = stream.subscribe(() => {});
    settle("a");
    first.unsubscribe();

    stream.reload();
    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    expect(requests).toEqual(["a", "a"]);
  });

  it("factory.reload() drops the kept values", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const first = factory.get("a").subscribe(() => {});
    settle("a");
    first.unsubscribe();

    factory.reload();
    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();

    expect(requests).toEqual(["a", "a"]);
  });

  it("a reload that matches nothing keeps the value", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const first = factory.get("a").subscribe(() => {});
    settle("a");
    first.unsubscribe();

    factory.get("a").reload({ where: () => false });
    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();

    expect(requests).toEqual(["a"]);
  });

  it("drops kept values on active: false while nobody is subscribed", () => {
    const { requests, loader, settle } = controlledLoader();
    const active = new BehaviorSubject(true);
    const factory = statefulObservableFactory({ loader, active });

    const first = factory.get("a").subscribe(() => {});
    settle("a");
    first.unsubscribe();

    active.next(false);
    active.next(true);
    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();

    expect(requests).toEqual(["a", "a"]);
  });

  it("watches active only while a value is kept, with one subscription", () => {
    const { loader, settle } = controlledLoader();
    const active = new BehaviorSubject(true);
    const factory = statefulObservableFactory({ loader, active });
    expect(active.observers.length).toBe(0);

    ["a", "b", "c"].forEach((id) => {
      const subscription = factory.get(id).subscribe(() => {});
      settle(id);
      subscription.unsubscribe();
    });
    expect(active.observers.length).toBe(1);

    active.next(false);
    expect(active.observers.length).toBe(0);
  });

  it("reset(true) ends the watch on active", () => {
    const { loader, settle } = controlledLoader();
    const active = new BehaviorSubject(true);
    const factory = statefulObservableFactory({ loader, active });

    const subscription = factory.get("a").subscribe(() => {});
    settle("a");
    subscription.unsubscribe();
    factory.reset(true);

    expect(active.observers.length).toBe(0);
  });

  it("does not keep a load that completes after a logout cut it off", () => {
    const { requests, loader, responses } = controlledLoader();
    const active = new BehaviorSubject(true);
    const factory = statefulObservableFactory({ loader, active });

    const subscription = factory.get("a").subscribe(() => {});
    active.next(false);
    // the cut-off request is released a microtask later, so it can still complete
    responses[0].response.next("previous user");
    responses[0].response.complete();
    active.next(true);

    expect(requests).toEqual(["a", "a"]);
    subscription.unsubscribe();
  });

  it("does not keep a load that completes after a reload replaced it", () => {
    const { requests, loader, responses, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const values: string[] = [];
    const stream = factory.get("a");
    const subscription = stream.subscribe((v) => values.push(v));
    stream.reload();
    responses[0].response.next("outdated");
    responses[0].response.complete();
    subscription.unsubscribe();

    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    expect(requests).toEqual(["a", "a", "a"]);
    expect(values).toEqual([]);

    const fresh = factory.get("a").subscribe((v) => values.push(v));
    settle("a", "fresh");
    fresh.unsubscribe();
    expect(values).toEqual(["fresh"]);
  });

  it("an entry that left the cache does not serve its kept value", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader, cacheSize: 1 });

    const held = factory.get("a");
    const first = held.subscribe(() => {});
    settle("a");
    first.unsubscribe();

    factory.reset(false);
    held.subscribe(() => {}).unsubscribe();

    expect(requests).toEqual(["a", "a"]);
  });
});

describe("statefulObservableFactory, refCount: false", () => {
  it("lets a load in flight finish and keeps it", async () => {
    const { requests, cancelled, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader, refCount: false });

    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    await released();
    expect(cancelled).toEqual([]);

    settle("a");
    const values: string[] = [];
    factory
      .get("a")
      .subscribe((v) => values.push(v))
      .unsubscribe();

    expect(requests).toEqual(["a"]);
    expect(values).toEqual(["value a"]);
  });

  it("keeps a streaming loader connected", () => {
    const { requests, loader, latest } = controlledLoader();
    const factory = statefulObservableFactory({ loader, refCount: false });

    factory
      .get("a")
      .subscribe(() => {})
      .unsubscribe();
    latest("a")?.next("tick 1");
    latest("a")?.next("tick 2");

    const values: string[] = [];
    factory
      .get("a")
      .subscribe((v) => values.push(v))
      .unsubscribe();

    expect(requests).toEqual(["a"]);
    expect(values).toEqual(["tick 2"]);
  });
});

describe("statefulObservableBatchFactory: cancel if pending, keep if settled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const batchFactory = () => {
    const calls: (readonly string[])[] = [];
    const responses: Subject<readonly string[]>[] = [];
    let cancelled = 0;
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly string[]) => {
        calls.push(ids);
        const response = new Subject<readonly string[]>();
        responses.push(response);
        return new Observable<readonly string[]>((subscriber) => {
          let settled = false;
          const subscription = response.subscribe({
            next: (items) => subscriber.next(items),
            complete: () => {
              settled = true;
              subscriber.complete();
            },
          });
          return () => {
            subscription.unsubscribe();
            if (!settled) cancelled++;
          };
        });
      },
      idOf: (item: string) => item,
    });
    return { factory, calls, responses, cancelled: () => cancelled };
  };

  it("cancels an in-flight batch when its last consumer leaves", async () => {
    const { factory, cancelled } = batchFactory();

    const subscription = factory.get("a").subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    subscription.unsubscribe();
    await released();

    expect(cancelled()).toBe(1);
  });

  it("serves a settled item to a returning consumer without a new batch", async () => {
    const { factory, calls, responses } = batchFactory();

    const first = factory.get("a").subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    responses[0].next(["a"]);
    responses[0].complete();
    first.unsubscribe();

    const values: string[] = [];
    const second = factory.get("a").subscribe((v) => values.push(v));
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([["a"]]);
    expect(values).toEqual(["a"]);
    second.unsubscribe();
  });

  it("drops an id that scrolled away before its batch was sent", async () => {
    const { factory, calls } = batchFactory();

    const a = factory.get("a").subscribe(() => {});
    factory
      .get("b")
      .subscribe(() => {})
      .unsubscribe();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([["a"]]);
    a.unsubscribe();
  });
});
