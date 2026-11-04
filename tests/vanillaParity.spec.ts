// Differential tests: the same operators applied through pipeValue on a
// stateful observable and through plain RxJS must emit the same values at the
// same (virtual) times. Cases where the library differs by design are in their
// own block and assert the difference explicitly.
import {
  auditTime,
  bufferCount,
  concatMap,
  concatWith,
  count,
  debounceTime,
  delay,
  delayWhen,
  dematerialize,
  distinct,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  expand,
  filter,
  first,
  groupBy,
  interval,
  last,
  map,
  materialize,
  mergeMap,
  NEVER,
  Observable,
  of,
  OperatorFunction,
  pairwise,
  pipe,
  range,
  reduce,
  scan,
  shareReplay,
  skip,
  startWith,
  switchMap,
  take,
  takeWhile,
  throttleTime,
  timer,
  toArray,
  withLatestFrom,
} from "rxjs";
import { TestScheduler } from "rxjs/testing";
import { statefulObservable } from "../src/statefulObservable";

const scheduler = () =>
  new TestScheduler((actual, expected) => expect(actual).toEqual(expected));

// compare next notifications only: a stateful root does not complete
const valuesOnly = <T>(source: Observable<T>): Observable<T> =>
  source.pipe(
    materialize(),
    filter((notification) => notification.kind === "N"),
    dematerialize(),
    concatWith(NEVER), // ignore completion as well
  );

const values = { a: 1, b: 2, c: 3, d: 4, e: 2, f: 5 };

type Case = {
  readonly name: string;
  readonly input: string;
  readonly op: OperatorFunction<number, unknown>;
};

const slowTimes10 = (ms: number) => (v: number) =>
  timer(ms).pipe(map(() => v * 10));

const parity: Case[] = [
  // higher-order
  { name: "switchMap to a slow inner", input: "a-b---c-|", op: switchMap(slowTimes10(3)) },
  { name: "mergeMap to a slow inner", input: "a-b---c-|", op: mergeMap(slowTimes10(3)) },
  { name: "concatMap to a slow inner", input: "a-b---c-|", op: concatMap(slowTimes10(3)) },
  { name: "exhaustMap to a slow inner", input: "a-b---c-|", op: exhaustMap(slowTimes10(3)) },
  { name: "mergeMap with concurrency 1", input: "abc|", op: mergeMap(slowTimes10(2), 1) },
  {
    name: "switchMap to a multi-emission inner",
    input: "a----b----|",
    op: switchMap((v: number) => interval(2).pipe(take(3), map((i) => v * 10 + i))),
  },
  {
    name: "expand",
    input: "a-c-|",
    op: expand((v: number) => (v < 4 ? of(v + 1) : EMPTY)),
  },
  {
    name: "groupBy with a running sum per group",
    input: "abcdef|",
    op: pipe(
      groupBy((v: number) => v % 2),
      mergeMap((group) => group.pipe(scan((acc, v) => acc + v, 0))),
    ),
  },
  {
    // bounded: an unbounded interval never stops, because a stateful root does
    // not complete (see the completion cases below)
    name: "withLatestFrom a bounded interval",
    input: "--a---b---c|",
    op: withLatestFrom(interval(3).pipe(take(4))),
  },
  // completion-dependent operators on inner streams, which complete
  {
    name: "reduce inside switchMap",
    input: "a-c-d|",
    op: switchMap((v: number) => range(1, v).pipe(reduce((acc, x) => acc + x, 0))),
  },
  {
    name: "toArray inside mergeMap",
    input: "a-c|",
    op: mergeMap((v: number) => interval(1).pipe(take(v), toArray())),
  },
  {
    name: "last and count inside concatMap",
    input: "cd|",
    op: concatMap((v: number) =>
      range(1, v).pipe(
        count(),
        map((n) => n * 10),
        last(),
      ),
    ),
  },
  {
    name: "bufferCount and debounceTime inside switchMap",
    input: "a----d|",
    op: switchMap((v: number) => interval(1).pipe(take(v + 2), bufferCount(2), debounceTime(1))),
  },
  // stateful
  { name: "scan", input: "abcd|", op: scan((acc: number, v: number) => acc + v, 0) },
  { name: "distinctUntilChanged", input: "aabbaa|", op: distinctUntilChanged() },
  { name: "distinct", input: "abeab|", op: distinct() },
  { name: "pairwise", input: "abcd|", op: pairwise() },
  { name: "bufferCount (full buffers)", input: "abcd|", op: bufferCount(2) },
  { name: "startWith", input: "-a-b|", op: startWith(0) },
  { name: "take", input: "abcd|", op: take(2) },
  { name: "skip", input: "abcd|", op: skip(2) },
  { name: "takeWhile", input: "abcda|", op: takeWhile((v: number) => v < 3) },
  { name: "first", input: "abc|", op: first() },
  // time-based
  { name: "debounceTime (no flush on completion)", input: "ab--c---d---|", op: debounceTime(2) },
  { name: "throttleTime", input: "abcd--e|", op: throttleTime(3) },
  { name: "auditTime", input: "abcd--e|", op: auditTime(3) },
  { name: "delay", input: "a-b-c|", op: delay(2) },
  { name: "delayWhen", input: "abc|", op: delayWhen((v: number) => timer(v * 2)) },
  // combinations
  {
    name: "scan then switchMap to a slow inner",
    input: "a-b---c-|",
    op: pipe(scan((acc: number, v: number) => acc + v, 0), switchMap(slowTimes10(3))),
  },
  {
    name: "distinctUntilChanged then concatMap",
    input: "aab-bc|",
    op: pipe(distinctUntilChanged(), concatMap(slowTimes10(1))),
  },
  {
    name: "shareReplay inside a chain",
    input: "a-b-c|",
    op: pipe(map((v: number) => v * 2), shareReplay(1), scan((acc: number, v: number) => acc + v, 0)),
  },
];

describe("pipeValue matches vanilla RxJS", () => {
  it.each(parity)("$name", ({ input, op }) => {
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold(input, values);
      const vanilla = source.pipe(op);
      const stateful = statefulObservable(source).pipeValue(op).value$;
      expectObservable(valuesOnly(stateful)).toEqual(valuesOnly(vanilla));
    });
  });
});

describe("differs from vanilla RxJS by design", () => {
  it.each([
    { name: "reduce", op: reduce((acc: number, v: number) => acc + v, 0) },
    { name: "last", op: last() },
    { name: "toArray", op: toArray() },
    { name: "count", op: count() },
  ])("$name: completion-dependent operators never emit, because a root does not complete", ({ op }) => {
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("abc|", values);
      expectObservable(valuesOnly(source.pipe(op))).toBe("---x", { x: expect.anything() });
      expectObservable(valuesOnly(statefulObservable(source).pipeValue(op).value$)).toBe("");
    });
  });

  it("bufferCount: the final partial buffer is not flushed, because a root does not complete", () => {
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("abcde|", values);
      const op = bufferCount(2);
      expectObservable(valuesOnly(source.pipe(op))).toBe("-a-b-c", { a: [1, 2], b: [3, 4], c: [2] });
      expectObservable(valuesOnly(statefulObservable(source).pipeValue(op).value$)).toBe("-a-b", {
        a: [1, 2],
        b: [3, 4],
      });
    });
  });

  it("debounceTime: a pending value waits for the timer instead of being flushed on completion", () => {
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("ab--c---d|", values);
      const op = debounceTime(2);
      expectObservable(valuesOnly(source.pipe(op))).toBe("---b--c--d", { b: 2, c: 3, d: 4 });
      expectObservable(valuesOnly(statefulObservable(source).pipeValue(op).value$)).toBe(
        "---b--c---d",
        { b: 2, c: 3, d: 4 },
      );
    });
  });

  it("an operator error ends vanilla, but the pipe reports it and processes later values", () => {
    const failOnTwo = map((v: number) => {
      if (v === 2) throw "boom";
      return v * 10;
    });
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("abc|", values);
      expectObservable(source.pipe(failOnTwo)).toBe("a#", { a: 10 }, "boom");
      const stateful = statefulObservable(source).pipeValue(failOnTwo);
      expectObservable(valuesOnly(stateful.value$)).toBe("a-c", { a: 10, c: 30 });
      expectObservable(valuesOnly(stateful.error$)).toBe("abc", { a: false, b: "boom", c: false });
    });
  });

  it("operator state restarts after an error, because only the pipeline is rebuilt", () => {
    const sumUnlessZero = pipe(
      map((v: number) => {
        if (v === 0) throw "zero";
        return v;
      }),
      scan((acc: number, v: number) => acc + v, 0),
    );
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("abzc|", { ...values, z: 0 });
      const stateful = statefulObservable(source).pipeValue(sumUnlessZero).value$;
      expectObservable(valuesOnly(stateful)).toBe("ab-c", { a: 1, b: 3, c: 3 });
    });
  });

  it("with an asynchronous loader, a result that lands while a newer load is pending is dropped", () => {
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("a-b|", values);
      // a loads in 1 frame, b in 3: a's slow result (frame 4) lands while b loads (2..5)
      const load = (v: number) => of(v).pipe(delay(v === 1 ? 1 : 3));
      const slow = mergeMap(slowTimes10(3));
      // vanilla: both inner results arrive
      expectObservable(valuesOnly(source.pipe(mergeMap(load), slow))).toBe("----a---b", {
        a: 10,
        b: 20,
      });
      // stateful: b's loading closes the gate, so a's result is dropped
      const stateful = statefulObservable({ input: source, loader: load }).pipeValue(slow).value$;
      expectObservable(valuesOnly(stateful)).toBe("--------b", { b: 20 });
    });
  });

  it("once the newer value is fed, the operator's concurrency decides: mergeMap lets a late result through", () => {
    scheduler().run(({ cold, expectObservable }) => {
      const source = cold("a-b|", values);
      const load = (v: number) => of(v).pipe(delay(1));
      const slow = mergeMap(slowTimes10(3));
      // b is fed at frame 3, a's result arrives at frame 4: same as vanilla
      const stateful = statefulObservable({ input: source, loader: load }).pipeValue(slow).value$;
      expectObservable(valuesOnly(stateful)).toBe("----a-b", { a: 10, b: 20 });
    });
  });
});
