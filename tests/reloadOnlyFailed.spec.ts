import { map, of, throwError } from "rxjs";
import { vi } from "vitest";
import { combineStatefulObservables } from "../src/combineStatefulObservables";
import { errorSymbol } from "../src/response-container";
import { statefulObservable } from "../src/statefulObservable";

const settle = () => new Promise((r) => setTimeout(r, 10));

const makeFlakySource = (failFirst: number, value: number) => {
  const calls = { count: 0 };
  const source$ = statefulObservable({
    loader: () => {
      calls.count++;
      return calls.count <= failFirst
        ? throwError(() => new Error(`fail #${calls.count}`))
        : of(value);
    },
  });
  return { source$, calls };
};

const makeHealthySource = (value: number) => makeFlakySource(0, value);

describe("reload({ onlyFailed: true })", () => {
  it("reloads only the failed source; reload() still reloads all", async () => {
    const a = makeFlakySource(1, 1);
    const b = makeHealthySource(10);
    const c = makeHealthySource(100);
    const combined = combineStatefulObservables(
      [a.source$, b.source$, c.source$],
      ([x, y, z]) => x + y + z,
    );

    const raw: unknown[] = [];
    const sub = combined.raw$.subscribe((e) => raw.push(e));
    await settle();
    expect(raw[raw.length - 1]).toMatchObject({ state: errorSymbol });
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([1, 1, 1]);

    combined.reload({ onlyFailed: true });
    await settle();
    expect(raw[raw.length - 1]).toBe(111);
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([2, 1, 1]);

    combined.reload();
    await settle();
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([3, 2, 2]);

    sub.unsubscribe();
  });

  it("propagates the flag through a multi-layer graph", async () => {
    const a = makeFlakySource(1, 1);
    const b = makeHealthySource(10);
    const c = makeHealthySource(100);
    const inner = combineStatefulObservables(
      [a.source$, b.source$],
      ([x, y]) => x + y,
    );
    const outer = combineStatefulObservables(
      [inner.pipeValue(map((x) => x + 1)), c.source$],
      ([x, y]) => x + y,
    );

    const raw: unknown[] = [];
    const sub = outer.raw$.subscribe((e) => raw.push(e));
    await settle();
    expect(raw[raw.length - 1]).toMatchObject({ state: errorSymbol });

    outer.reload({ onlyFailed: true });
    await settle();

    expect(raw[raw.length - 1]).toBe(112);
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([2, 1, 1]);

    sub.unsubscribe();
  });

  it("reloads every failed source and skips the healthy one", async () => {
    const a = makeFlakySource(1, 1);
    const b = makeHealthySource(10);
    const c = makeFlakySource(1, 100);
    const combined = combineStatefulObservables(
      [a.source$, b.source$, c.source$],
      ([x, y, z]) => x + y + z,
    );

    const raw: unknown[] = [];
    const sub = combined.raw$.subscribe((e) => raw.push(e));
    await settle();

    combined.reload({ onlyFailed: true });
    await settle();

    expect(raw[raw.length - 1]).toBe(111);
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([2, 1, 2]);

    sub.unsubscribe();
  });

  it("refetches nothing when all sources are healthy", async () => {
    const a = makeHealthySource(1);
    const b = makeHealthySource(10);
    const combined = combineStatefulObservables(
      [a.source$, b.source$],
      ([x, y]) => x + y,
    );

    const raw: unknown[] = [];
    const sub = combined.raw$.subscribe((e) => raw.push(e));
    await settle();
    const emitted = raw.length;

    combined.reload({ onlyFailed: true });
    await settle();

    expect([a.calls.count, b.calls.count]).toEqual([1, 1]);
    expect(raw.length).toBe(emitted);

    sub.unsubscribe();
  });

  it("counts errors produced by a derived (pipeError-ed) source's own raw$", async () => {
    const a = makeFlakySource(1, 1);
    const b = makeHealthySource(10);
    const combined = combineStatefulObservables(
      [a.source$.pipeError(map(() => "wrapped")), b.source$],
      ([x, y]) => x + y,
    );

    const sub = combined.raw$.subscribe();
    await settle();
    combined.reload({ onlyFailed: true });
    await settle();

    expect([a.calls.count, b.calls.count]).toEqual([2, 1]);
    sub.unsubscribe();
  });

  it("falls back to reloading all sources when there is no information", async () => {
    const s1 = statefulObservable({ loader: () => of(1) });
    const s2 = statefulObservable({ loader: () => of(2) });
    const reload1 = vi.spyOn(s1, "reload");
    const reload2 = vi.spyOn(s2, "reload");
    const combined = combineStatefulObservables([s1, s2], ([x, y]) => x + y);

    // never subscribed
    combined.reload({ onlyFailed: true });
    expect(reload1).toHaveBeenCalledTimes(1);
    expect(reload2).toHaveBeenCalledTimes(1);

    // subscribed, then refCount dropped to zero: information is discarded
    const sub = combined.raw$.subscribe();
    await settle();
    sub.unsubscribe();
    combined.reload({ onlyFailed: true });
    expect(reload1).toHaveBeenCalledTimes(2);
    expect(reload2).toHaveBeenCalledTimes(2);
    // fallback calls sources without options
    expect(reload1).toHaveBeenLastCalledWith(undefined);
  });

  it("a plain root ignores the flag and reloads", async () => {
    const a = makeHealthySource(1);
    const sub = a.source$.raw$.subscribe();
    await settle();

    a.source$.reload({ onlyFailed: true });
    await settle();

    expect(a.calls.count).toBe(2);
    sub.unsubscribe();
  });
});
