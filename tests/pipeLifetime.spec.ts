import {
  BehaviorSubject,
  defer,
  delay,
  map,
  of,
  share,
  Subject,
  takeUntil,
  shareReplay,
  throwError,
  timer,
} from "rxjs";
import { isError, isLoading } from "../src/response-container";
import { statefulObservable } from "../src/statefulObservable";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const countingSource = () => {
  const calls = { count: 0 };
  const loader = () =>
    defer(() => {
      calls.count++;
      return of(calls.count);
    });
  return { calls, loader };
};

const takeValue = (stream: { subscribe: (fn: (v: number) => void) => { unsubscribe: () => void } }) => {
  const values: number[] = [];
  stream.subscribe((v) => values.push(v)).unsubscribe();
  return values;
};

describe("pipe(takeUntil(destroy$), shareReplay(1)) releases the source on destroy", () => {
  // takeUntil(destroy$) stands in for Angular's takeUntilDestroyed()
  const setup = () => {
    const input = new Subject<number>();
    const destroy$ = new Subject<void>();
    const node = statefulObservable({ input, loader: (v: number) => of(v * 10) }).pipe(
      takeUntil(destroy$),
      shareReplay(1),
    );
    return { input, destroy$, node };
  };

  it("destroy after the last subscriber left: kept alive until destroy, released after", () => {
    const { input, destroy$, node } = setup();
    node.subscribe(() => {}).unsubscribe();
    expect(input.observed).toBe(true); // shareReplay(1) holds it

    destroy$.next();
    expect(input.observed).toBe(false);
  });

  it("destroy while still subscribed, then the subscriber leaves: released", () => {
    const { input, destroy$, node } = setup();
    const sub = node.subscribe(() => {});
    destroy$.next();
    sub.unsubscribe();
    expect(input.observed).toBe(false);
  });

  it("the same with a shared parent: the parent is released too when nothing else uses it", () => {
    const input = new Subject<number>();
    const destroy$ = new Subject<void>();
    const parent = statefulObservable({ input, loader: (v: number) => of(v) });
    const child = parent.pipeValue(map((v: number) => v + 1)).pipe(takeUntil(destroy$), shareReplay(1));

    child.subscribe(() => {}).unsubscribe();
    expect(input.observed).toBe(true);
    destroy$.next();
    expect(input.observed).toBe(false);
  });

  it("subscribe without unsubscribe, relying on takeUntil: completes and releases, as in plain RxJS", () => {
    const input = new Subject<number>();
    const destroy$ = new Subject<void>();
    const node = statefulObservable({ input, loader: (v: number) => of(v) }).pipe(takeUntil(destroy$));
    let completed = false;
    node.subscribe({ complete: () => (completed = true) }); // never unsubscribed

    destroy$.next();
    expect(completed).toBe(true);
    expect(input.observed).toBe(false);
  });

  it("without takeUntil, shareReplay(1) keeps the source for the node's life, as in plain RxJS", () => {
    const input = new Subject<number>();
    const node = statefulObservable({ input, loader: (v: number) => of(v) }).pipe(shareReplay(1));
    node.subscribe(() => {}).unsubscribe();
    expect(input.observed).toBe(true);
  });
});

describe("pipe lifetime follows the operators inside it", () => {
  it("plain operators release the node when the last subscriber leaves", () => {
    const { calls, loader } = countingSource();
    const stream = statefulObservable({ loader }).pipeValue(map((v: number) => v * 10));

    expect(takeValue(stream)).toEqual([10]);
    expect(takeValue(stream)).toEqual([20]);
    expect(calls.count).toBe(2);
  });

  it("shareReplay(1) keeps the node alive and replays to the next subscriber", () => {
    const { calls, loader } = countingSource();
    const stream = statefulObservable({ loader }).pipe(shareReplay(1));

    expect(takeValue(stream)).toEqual([1]);
    expect(takeValue(stream)).toEqual([1]);
    expect(calls.count).toBe(1);
  });

  it("shareReplay with refCount: true releases it", () => {
    const { calls, loader } = countingSource();
    const stream = statefulObservable({ loader }).pipe(
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    takeValue(stream);
    takeValue(stream);
    expect(calls.count).toBe(2);
  });

  it("a delayed release is honoured when it happens", async () => {
    const { calls, loader } = countingSource();
    const stream = statefulObservable({ loader }).pipe(
      share({ resetOnRefCountZero: () => timer(20) }),
    );

    takeValue(stream);
    await wait(5);
    takeValue(stream); // within the grace period: still connected
    expect(calls.count).toBe(1);

    await wait(40);
    takeValue(stream); // released in between
    expect(calls.count).toBe(2);
  });

  it("a returning subscriber gets the latest state, not a stale buffered value", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({
      input,
      loader: (id: number) =>
        id === 2 ? throwError(() => "failed") : of(id * 10).pipe(delay(1)),
    }).pipe(shareReplay(1));
    stream.error$.subscribe(); // silence the console warning

    const first: unknown[] = [];
    const sub = stream.raw$.subscribe((e) => first.push(e));
    await wait(10);
    sub.unsubscribe();
    expect(first[first.length - 1]).toBe(10);

    input.next(2); // fails while nobody is subscribed
    await wait(10);

    const second: unknown[] = [];
    stream.raw$.subscribe((e) => second.push(e)).unsubscribe();
    expect(second.length).toBeGreaterThan(0);
    expect(isError(second[second.length - 1])).toBe(true);
  });

  it("a returning subscriber sees loading when a new load is in flight", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({
      input,
      loader: (id: number) => of(id * 10).pipe(delay(20)),
    }).pipe(shareReplay(1));

    const sub = stream.raw$.subscribe();
    await wait(30);
    sub.unsubscribe();

    input.next(2); // starts while nobody is subscribed
    const seen: unknown[] = [];
    const again = stream.raw$.subscribe((e) => seen.push(e));
    expect(isLoading(seen[seen.length - 1])).toBe(true);
    await wait(30);
    expect(seen[seen.length - 1]).toBe(20);
    again.unsubscribe();
  });
});
