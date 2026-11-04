import {
  distinctUntilChanged,
  map,
  mergeMap,
  Observable,
  OperatorFunction,
  scan,
  startWith,
  Subject,
  timer,
} from "rxjs";
import { pipeError, pipeRaw, pipeValue } from "../src/operators";
import {
  errorSymbol,
  inactiveSymbol,
  isError,
  isInactive,
  isLoading,
  loadingSymbol,
} from "../src/response-container";
import type { ResponseWithStatus } from "../src/types";

type Raw = ResponseWithStatus<number>;
const L: Raw = { state: loadingSymbol };
const I: Raw = { state: inactiveSymbol };
const E = (error: unknown): Raw => ({ state: errorSymbol, error });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const show = (event: unknown): string =>
  isLoading(event) ? "L" : isInactive(event) ? "I" : isError(event) ? `E(${String(event.error)})` : String(event);

// feeds raw events through a pipe operator and records what comes out
const run = async (
  operator: OperatorFunction<Raw, unknown>,
  events: Raw[],
): Promise<string[]> => {
  const input = new Subject<Raw>();
  const out: string[] = [];
  const sub = (input.asObservable() as Observable<Raw>)
    .pipe(operator)
    .subscribe((event) => out.push(show(event)));
  events.forEach((event) => input.next(event));
  await wait(40);
  sub.unsubscribe();
  return out;
};

const slow = mergeMap((v: number) => timer(20).pipe(map(() => v * 10)));

describe("pipes keep operator state and isolate failures", () => {
  it("distinctUntilChanged works across values", async () => {
    // the repeated 1 is dropped (the node stays pending), then 2 comes through
    expect(await run(pipeValue(distinctUntilChanged()), [L, 1, L, 1, L, 2])).toEqual([
      "L",
      "1",
      "L",
      "2",
    ]);
  });

  it("scan accumulates across values", async () => {
    const out = await run(pipeValue(scan((acc: number, v: number) => acc + v, 0)), [L, 1, L, 2, L, 3]);
    expect(out.filter((x) => x !== "L")).toEqual(["1", "3", "6"]);
  });

  it("startWith emits once, not before every value", async () => {
    const out = await run(pipeValue(startWith(0)), [L, 1, L, 2]);
    expect(out.filter((x) => x !== "L")).toEqual(["0", "1", "2"]);
  });

  it("an operator error becomes an error event and later values are still processed", async () => {
    const failOnTwo = map((v: number) => {
      if (v === 2) throw "boom";
      return v;
    });
    const out = await run(pipeValue(failOnTwo), [L, 1, L, 2, L, 3]);
    expect(out).toEqual(["L", "1", "L", "E(boom)", "L", "3"]);
  });

  it("state survives an operator error only from the rebuild on: scan restarts", async () => {
    const sumOrFail = [
      map((v: number) => {
        if (v === 0) throw "zero";
        return v;
      }),
      scan((acc: number, v: number) => acc + v, 0),
    ] as const;
    const out = await run(pipeValue(...sumOrFail), [1, 2, 0, 5]);
    expect(out).toEqual(["1", "3", "E(zero)", "5"]);
  });

  it("a late result does not override a newer error", async () => {
    expect(await run(pipeValue(slow), [L, 1, L, E("b")])).toEqual(["L", "E(b)"]);
  });

  it("a late result does not override a newer loading", async () => {
    expect(await run(pipeValue(slow), [L, 1, L])).toEqual(["L"]);
  });

  it("inactive cancels work in flight and resets operator state", async () => {
    const out = await run(pipeValue(scan((acc: number, v: number) => acc + v, 0)), [1, 2, I, 5]);
    expect(out).toEqual(["1", "3", "I", "5"]);
    expect(await run(pipeValue(slow), [L, 1, I])).toEqual(["L", "I"]);
  });

  it("a value dropped by an operator keeps the node pending", async () => {
    expect(await run(pipeValue(distinctUntilChanged()), [1, 1])).toEqual(["1", "L"]);
  });

  it("pipeError keeps state across errors", async () => {
    const count = scan((n: number) => n + 1, 0);
    const out = await run(pipeError(count), [E("a"), 1, E("b")]);
    expect(out).toEqual(["E(1)", "1", "E(2)"]);
  });

  it("pipe (raw) isolates an operator error", async () => {
    const failOnTwo = map((event: Raw) => {
      if (event === 2) throw "raw boom";
      return event;
    });
    expect(await run(pipeRaw(failOnTwo), [1, 2, 3])).toEqual(["1", "E(raw boom)", "3"]);
  });
});
