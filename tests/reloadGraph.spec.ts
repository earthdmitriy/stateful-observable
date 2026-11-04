import { map, of, throwError } from "rxjs";
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

describe("reload through a derived graph", () => {
  it("recovers a multi-layer graph with a single reload() on the final handle", async () => {
    const a = makeFlakySource(1, 1);
    const b = makeHealthySource(10);
    const c = makeHealthySource(100);

    const ab$ = combineStatefulObservables(
      [a.source$.pipeValue(map((x) => x * 2)), b.source$],
      ([x, y]) => x + y,
    );
    const final$ = combineStatefulObservables(
      [ab$.pipeValue(map((x) => x + 1)), c.source$],
      ([x, y]) => x + y,
    ).pipeError(map(() => "wrapped"));

    const raw: unknown[] = [];
    const sub = final$.raw$.subscribe((e) => raw.push(e));
    await settle();

    expect(raw[raw.length - 1]).toEqual({
      state: errorSymbol,
      error: "wrapped",
    });
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([1, 1, 1]);

    raw.length = 0;
    final$.reload();
    await settle();

    // (1 * 2 + 10) + 1 + 100
    expect(raw[raw.length - 1]).toBe(113);
    expect(raw).not.toContainEqual({ state: errorSymbol, error: "wrapped" });
    // all-or-nothing reload: healthy sources are reloaded too
    expect([a.calls.count, b.calls.count, c.calls.count]).toEqual([2, 2, 2]);

    sub.unsubscribe();
  });

  it("recovers through pipes only (no combine) by reaching the root source", async () => {
    const a = makeFlakySource(1, 5);
    const piped$ = a.source$
      .pipeValue(map((x) => x + 1))
      .pipeValue(map((x) => x * 10));

    const raw: unknown[] = [];
    const sub = piped$.raw$.subscribe((e) => raw.push(e));
    await settle();

    expect(raw[raw.length - 1]).toMatchObject({ state: errorSymbol });
    expect(a.calls.count).toBe(1);

    raw.length = 0;
    piped$.reload();
    await settle();

    // synchronous loader: the recovered value comes without a loading event
    expect(raw).toEqual([60]);
    expect(a.calls.count).toBe(2);

    sub.unsubscribe();
  });

  it("emits the error again when the source keeps failing after reload", async () => {
    const a = makeFlakySource(2, 1);
    const b = makeHealthySource(10);
    const final$ = combineStatefulObservables(
      [a.source$.pipeValue(map((x) => x * 2)), b.source$],
      ([x, y]) => x + y,
    );

    const errors: unknown[] = [];
    const values: number[] = [];
    const errSub = final$.error$.subscribe((e) => errors.push(e));
    const valSub = final$.value$.subscribe((v) => values.push(v));
    await settle();

    expect(errors[errors.length - 1]).toEqual([expect.any(Error), false]);
    const errorsAfterFirst = errors.length;

    final$.reload();
    await settle();

    // still failing: error emitted again, stream is not dead
    expect(a.calls.count).toBe(2);
    expect(errors.length).toBeGreaterThan(errorsAfterFirst);
    expect(errors[errors.length - 1]).toEqual([expect.any(Error), false]);
    expect(values).toEqual([]);

    // third attempt succeeds: same stream still alive
    final$.reload();
    await settle();

    expect(a.calls.count).toBe(3);
    // sources reload one by one, so the combined value may be re-emitted
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === 12)).toBe(true);
    expect(errors[errors.length - 1]).toBe(false);

    errSub.unsubscribe();
    valSub.unsubscribe();
  });
});
