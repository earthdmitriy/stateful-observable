import { BehaviorSubject, Observable, of, Subject } from "rxjs";
import { statefulObservableBatchFactory } from "../src/batchFactory";
import { statefulObservableFactory } from "../src/factory";
import { isInactive } from "../src/response-container";

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
  const latest = (id: string) =>
    responses.filter((r) => r.id === id).at(-1)?.response;
  const settle = (id: string) => {
    latest(id)?.next(`value ${id}`);
    latest(id)?.complete();
  };
  const fail = (id: string, error: unknown) => latest(id)?.error(error);
  return { requests, cancelled, loader, settle, fail };
};

/** A loader is released a microtask after its last consumer leaves. */
const released = () => Promise.resolve();

describe("statefulObservableFactory.projectMany", () => {
  it("emits the values of a list in input order, one request per key", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const values: string[][] = [];
    const subscription = factory
      .projectMany(of(["b", "a", "b"]))
      .subscribe((v) => values.push(v));
    settle("a");
    settle("b");

    expect(requests).toEqual(["b", "a"]);
    expect(values).toEqual([["value b", "value a", "value b"]]);
    subscription.unsubscribe();
  });

  it("shares entries with get", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const direct: string[] = [];
    const a = factory.get("a").subscribe((v) => direct.push(v));
    const many = factory.projectMany(of(["a", "b"])).subscribe(() => {});
    settle("a");

    expect(requests).toEqual(["a", "b"]);
    expect(direct).toEqual(["value a"]);
    a.unsubscribe();
    many.unsubscribe();
  });

  it("emits [] for an empty list, without loading", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
    });
    const stream = factory.projectMany(of([]));

    const values: string[][] = [];
    const pending: boolean[] = [];
    const value = stream.subscribe((v) => values.push(v));
    const pendingSubscription = stream.pending$.subscribe((p) =>
      pending.push(p),
    );

    expect(values).toEqual([[]]);
    expect(pending).toEqual([false]);
    value.unsubscribe();
    pendingSubscription.unsubscribe();
  });

  it("is pending while any entry loads, and fails per item", () => {
    const { loader, settle, fail } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const stream = factory.projectMany(of(["a", "b"]));

    const pending: boolean[] = [];
    const errors: unknown[] = [];
    const pendingSubscription = stream.pending$.subscribe((p) =>
      pending.push(p),
    );
    const errorSubscription = stream.error$.subscribe((e) => errors.push(e));
    settle("a");
    // a combination emits loading again when a source settles while another loads
    expect(pending.at(-1)).toBe(true);

    fail("b", "boom");
    expect(pending.at(-1)).toBe(false);
    expect(errors).toEqual([[false, "boom"]]);
    pendingSubscription.unsubscribe();
    errorSubscription.unsubscribe();
  });

  it("keeps the load of an item that stays in the list, and releases the others", async () => {
    const { requests, cancelled, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const ids$ = new BehaviorSubject<readonly string[]>(["a", "b"]);

    const values: string[][] = [];
    const subscription = factory
      .projectMany(ids$)
      .subscribe((v) => values.push(v));
    ids$.next(["b", "c"]);
    await released();

    expect(requests).toEqual(["a", "b", "c"]);
    expect(cancelled).toEqual(["a"]);

    settle("b");
    settle("c");
    expect(values).toEqual([["value b", "value c"]]);
    subscription.unsubscribe();
  });

  it("serves a list of settled items synchronously when it comes back", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const ids$ = new BehaviorSubject<readonly string[]>(["a", "b"]);

    const values: string[][] = [];
    const subscription = factory
      .projectMany(ids$)
      .subscribe((v) => values.push(v));
    settle("a");
    settle("b");
    ids$.next(["c"]);
    ids$.next(["a", "b"]);

    expect(requests).toEqual(["a", "b", "c"]);
    expect(values).toEqual([
      ["value a", "value b"],
      ["value a", "value b"],
    ]);
    subscription.unsubscribe();
  });

  it("skips a list with the same keys, not a reordered one", () => {
    const { loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const ids$ = new BehaviorSubject<readonly string[]>(["a", "b"]);

    const values: string[][] = [];
    const subscription = factory
      .projectMany(ids$)
      .subscribe((v) => values.push(v));
    settle("a");
    settle("b");
    ids$.next(["a", "b"]);
    expect(values).toEqual([["value a", "value b"]]);

    ids$.next(["b", "a"]);
    expect(values).toEqual([
      ["value a", "value b"],
      ["value b", "value a"],
    ]);
    subscription.unsubscribe();
  });

  it("reload() reloads every item; path and onlyFailed reach single items", () => {
    const { requests, loader, settle, fail } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const stream = factory.projectMany(of(["a", "b", "c"]));

    const subscription = stream.subscribe({ error: () => {} });
    const errors = stream.error$.subscribe(() => {});
    settle("a");
    fail("b", "boom");
    settle("c");
    expect(requests).toEqual(["a", "b", "c"]);

    stream.reload({ onlyFailed: true });
    expect(requests).toEqual(["a", "b", "c", "b"]);
    settle("b");

    stream.reload({ path: [2] });
    expect(requests).toEqual(["a", "b", "c", "b", "c"]);
    settle("c");

    stream.reload();
    expect(requests).toEqual(["a", "b", "c", "b", "c", "a", "b", "c"]);
    subscription.unsubscribe();
    errors.unsubscribe();
  });

  it("reports no unhandled error while its error$ is subscribed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { loader, settle, fail } = controlledLoader();
      const factory = statefulObservableFactory({ loader });
      const stream = factory.projectMany(of(["a", "b"]));

      const errors = stream.error$.subscribe(() => {});
      settle("a");
      fail("b", "boom");

      expect(spy).not.toHaveBeenCalled();
      errors.unsubscribe();
    } finally {
      spy.mockRestore();
    }
  });

  it("turns a throwing cacheKey into an error event and keeps following its input", () => {
    const { loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({
      loader,
      cacheKey: (id: string) => {
        if (id === "bad") throw "bad key";
        return [id];
      },
    });
    const ids$ = new Subject<readonly string[]>();
    const stream = factory.projectMany(ids$);

    const errors: unknown[] = [];
    const values: string[][] = [];
    const errorSubscription = stream.error$.subscribe((e) => errors.push(e));
    const valueSubscription = stream.value$.subscribe((v) => values.push(v));
    ids$.next(["bad"]);
    ids$.next(["a"]);
    settle("a");

    expect(errors).toEqual(["bad key", false]);
    expect(values).toEqual([["value a"]]);
    errorSubscription.unsubscribe();
    valueSubscription.unsubscribe();
  });

  it("completes on reset(true)", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
    });
    let completed = false;
    factory
      .projectMany(of(["a"]))
      .subscribe({ complete: () => (completed = true) });

    factory.reset(true);

    expect(completed).toBe(true);
  });

  it("is inactive while active is false", () => {
    const active = new BehaviorSubject(false);
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
      active,
    });

    const inactive: boolean[] = [];
    const subscription = factory
      .projectMany(of(["a", "b"]))
      .raw$.subscribe((event) => inactive.push(isInactive(event)));

    expect(inactive).toEqual([true]);
    subscription.unsubscribe();
  });
});

describe("statefulObservableBatchFactory.projectMany", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads a list with one loader call", async () => {
    const calls: (readonly string[])[] = [];
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly string[]) => {
        calls.push(ids);
        return of(ids.map((id) => ({ id })));
      },
      idOf: (item) => item.id,
    });

    const values: { id: string }[][] = [];
    const subscription = factory
      .projectMany(of(["a", "b", "c"]))
      .subscribe((v) => values.push(v));
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([["a", "b", "c"]]);
    expect(values).toEqual([[{ id: "a" }, { id: "b" }, { id: "c" }]]);
    subscription.unsubscribe();
  });

  it("does not batch an item again when it stays in the list", async () => {
    const calls: (readonly string[])[] = [];
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly string[]) => {
        calls.push(ids);
        return of(ids.map((id) => ({ id })));
      },
      idOf: (item) => item.id,
      batchTime: 10,
    });
    const ids$ = new BehaviorSubject<readonly string[]>(["a", "b"]);

    const subscription = factory.projectMany(ids$).subscribe(() => {});
    ids$.next(["b", "c"]); // before the first batch is sent
    await vi.advanceTimersByTimeAsync(10);

    expect(calls).toEqual([["b", "c"]]);
    subscription.unsubscribe();
  });
});

describe("statefulObservableFactory.projectMany options", () => {
  type Line = { readonly sku: string; readonly qty: number };
  const describeLines = (
    responses: readonly string[],
    lines: readonly Line[],
  ): string =>
    lines.map((line, i) => `${responses[i]} x${line.qty}`).join(", ");

  it("selects the input of an item with key", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const values: string[][] = [];
    const subscription = factory
      .projectMany(
        of([
          { sku: "a", qty: 1 },
          { sku: "a", qty: 2 },
        ]),
        { key: (line) => line.sku },
      )
      .subscribe((v) => values.push(v));
    settle("a");

    expect(requests).toEqual(["a"]);
    expect(values).toEqual([["value a", "value a"]]);
    subscription.unsubscribe();
  });

  it("combines responses with the items they were loaded for", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const lines$ = new BehaviorSubject<readonly Line[]>([{ sku: "a", qty: 1 }]);
    const stream = factory.projectMany(lines$, {
      key: (line) => line.sku,
      combine: describeLines,
    });

    const events: unknown[] = [];
    const subscription = stream.raw$.subscribe((e) =>
      events.push(typeof e === "string" ? e : "loading"),
    );
    settle("a");
    // other items, same keys: no request, no loading
    lines$.next([{ sku: "a", qty: 3 }]);
    // other keys: loading until the new keys arrive, never a mixed value
    lines$.next([
      { sku: "a", qty: 3 },
      { sku: "b", qty: 5 },
    ]);
    settle("b");

    expect(requests).toEqual(["a", "b"]);
    expect(events).toEqual([
      "loading",
      "value a x1",
      "value a x3",
      "loading",
      "value a x3, value b x5",
    ]);
    subscription.unsubscribe();
  });

  it("combines without key when the items are inputs", () => {
    const { loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const values: string[] = [];
    const subscription = factory
      .projectMany(of(["a", "b"]), {
        combine: (responses, ids) => `${ids.join("+")}: ${responses.length}`,
      })
      .subscribe((v) => values.push(v));
    settle("a");
    settle("b");

    expect(values).toEqual(["a+b: 2"]);
    subscription.unsubscribe();
  });

  it("calls combine with an empty list, without loading", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
    });

    const values: number[] = [];
    const subscription = factory
      .projectMany(of<readonly Line[]>([]), {
        key: (line) => line.sku,
        combine: (responses) => responses.length,
      })
      .subscribe((v) => values.push(v));

    expect(values).toEqual([0]);
    subscription.unsubscribe();
  });

  it("turns a throw in combine into an error event and recovers on the next items", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const lines$ = new BehaviorSubject<readonly Line[]>([{ sku: "a", qty: 0 }]);
    const stream = factory.projectMany(lines$, {
      key: (line) => line.sku,
      combine: (responses: string[], lines: readonly Line[]) => {
        if (lines[0].qty === 0) throw "no qty";
        return describeLines(responses, lines);
      },
    });

    const errors: unknown[] = [];
    const values: string[] = [];
    const errorSubscription = stream.error$.subscribe((e) => errors.push(e));
    const valueSubscription = stream.value$.subscribe((v) => values.push(v));
    settle("a");
    lines$.next([{ sku: "a", qty: 2 }]);

    expect(requests).toEqual(["a"]);
    expect(errors).toEqual(["no qty", false]);
    expect(values).toEqual(["value a x2"]);
    errorSubscription.unsubscribe();
    valueSubscription.unsubscribe();
  });

  it("requires key when the items are not inputs", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
    });
    const lines$ = of<readonly Line[]>([]);
    const typeOnly = () => {
      // @ts-expect-error an item that is not an input needs a key
      factory.projectMany(lines$);
      // @ts-expect-error an item that is not an input needs a key
      factory.projectMany(lines$, { combine: (responses) => responses });
    };
    expect(typeOnly).toBeTypeOf("function");
  });
});

describe("statefulObservableFactory name", () => {
  it("names entries and projections after the factory", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
      name: "prices",
    });

    expect(factory.get("a").name).toBe("prices");
    expect(factory.project(of("a")).name).toBe("prices");
    expect(factory.projectMany(of(["a"])).name).toBe("prices");
  });

  it("defaults to unnamed", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
    });

    expect(factory.get("a").name).toBe("unnamed");
    expect(factory.projectMany(of(["a"])).name).toBe("unnamed");
  });

  it("is passed on by the batch factory", () => {
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly string[]) => of(ids.map((id) => ({ id }))),
      idOf: (item) => item.id,
      name: "products",
    });

    expect(factory.get("a").name).toBe("products");
  });
});
