import {
  BehaviorSubject,
  defer,
  delay,
  firstValueFrom,
  map,
  mergeMap,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  switchMap,
  take,
  throwError,
  toArray,
} from "rxjs";
import {
  errorSymbol,
  inactiveSymbol,
  loadingSymbol,
} from "./response-container";
import { statefulObservable } from "./statefulObservable";
import { ResponseWithStatus } from "./types";

class SampleService {
  input = new ReplaySubject<number>(1);
  available = new BehaviorSubject(true);
  process = jest.fn((value) => {
    return value * 2;
  });
  makeRequest = jest.fn((value) =>
    defer(() =>
      of(value).pipe(
        delay(1),
        map((v) => this.process(v)),
      ),
    ),
  );
  store = statefulObservable({
    input: this.input,
  }).pipeValue(switchMap((value) => this.makeRequest(value)));
}

describe("statefulObservable", () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await new Promise((r) => setTimeout(r, 5));
  });

  describe("basic", () => {
    it("bypass input", async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      });

      const res = await firstValueFrom(store.value$);

      expect(res).toEqual(1);
    });

    it("bypass input raw", async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      });

      const res = await firstValueFrom(store.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([{ state: loadingSymbol }, 1]);
    });

    it("dont keep state without subscribers", async () => {
      const sampleService = new SampleService();
      sampleService.input.next(1);

      const res = await firstValueFrom(sampleService.store.value$);

      expect(sampleService.makeRequest.mock.calls.length).toEqual(1);
      expect(res).toEqual(2);

      const res2 = await firstValueFrom(sampleService.store.value$);

      expect(sampleService.makeRequest.mock.calls.length).toEqual(2);
      expect(res2).toEqual(2);
    });

    it("pending flips during async operation", async () => {
      const sampleService = new SampleService();
      // subscribe to pending and collect two emissions: loading then not loading
      const pendingSeq$ = sampleService.store.pending$.pipe(take(2), toArray());
      // trigger a request
      sampleService.input.next(1);
      const pendingSeq = await firstValueFrom(pendingSeq$);
      expect(pendingSeq).toEqual([true, false]);
    });
  });

  describe("active", () => {
    it("behaves as usual when active=true", async () => {
      const active = new BehaviorSubject(true);
      const store = statefulObservable({
        input: new BehaviorSubject(1),
        active,
        loader: (value) => defer(() => of(value * 2).pipe(delay(1))),
      });

      const raw = await firstValueFrom(store.raw$.pipe(take(2), toArray()));
      expect(raw).toEqual([{ state: loadingSymbol }, 2]);

      const value = await firstValueFrom(store.value$);
      expect(value).toEqual(2);

      const pending = await firstValueFrom(
        store.pending$.pipe(take(2), toArray()),
      );
      expect(pending).toEqual([true, false]);
    });

    it("does not emit public events when inactive and keeps raw$ inactive internal event", async () => {
      const active = new BehaviorSubject(false);
      const loader = jest.fn((value: number) =>
        defer(() => of(value * 10).pipe(delay(1))),
      );
      const store = statefulObservable({
        input: new BehaviorSubject(1),
        active,
        loader,
      });

      const values: number[] = [];
      const errors: unknown[] = [];
      const pending: boolean[] = [];

      const subscribeNext = jest.fn();
      const subscribeError = jest.fn();
      const subscribePending = jest.fn();

      const vSub = store.value$.subscribe((v) => values.push(v));
      const eSub = store.error$.subscribe((e) => errors.push(e));
      const pSub = store.pending$.subscribe((p) => pending.push(p));
      const sSub = store.subscribe({
        next: subscribeNext,
        error: subscribeError,
        pending: subscribePending,
      });

      const rawFirst = await firstValueFrom(store.raw$.pipe(take(1)));
      expect(rawFirst).toEqual({ state: inactiveSymbol });

      await new Promise((r) => setTimeout(r, 5));

      expect(values).toEqual([]);
      expect(errors).toEqual([]);
      expect(pending).toEqual([]);
      expect(subscribeNext).not.toHaveBeenCalled();
      expect(subscribeError).not.toHaveBeenCalled();
      expect(subscribePending).not.toHaveBeenCalled();
      expect(loader).toHaveBeenCalledTimes(0);

      vSub.unsubscribe();
      eSub.unsubscribe();
      pSub.unsubscribe();
      sSub.unsubscribe();
    });

    it("keeps subscriptions alive across active toggles", async () => {
      const active = new BehaviorSubject(false);
      const input = new BehaviorSubject(2);
      const store = statefulObservable({
        input,
        active,
        loader: (value) => defer(() => of(value * 3).pipe(delay(1))),
      });

      const rawEvents: ResponseWithStatus<number, unknown>[] = [];
      const values: number[] = [];
      const pending: boolean[] = [];
      const errors: unknown[] = [];

      const rawSub = store.raw$.subscribe((event) => rawEvents.push(event));
      const subscribeSub = store.subscribe({
        next: (value) => values.push(value),
        pending: (value: boolean) => pending.push(value),
        error: (error: unknown) => errors.push(error),
      });

      await new Promise((r) => setTimeout(r, 5));
      expect(rawEvents).toEqual([{ state: inactiveSymbol }]);
      expect(values).toEqual([]);
      expect(pending).toEqual([]);
      expect(errors).toEqual([]);

      active.next(true);
      await new Promise((r) => setTimeout(r, 5));

      expect(rawEvents).toEqual([
        { state: inactiveSymbol },
        { state: loadingSymbol },
        6,
      ]);
      expect(values).toEqual([6]);
      expect(pending).toEqual([true, false]);
      expect(errors).toEqual([]);

      active.next(false);
      input.next(3);
      await new Promise((r) => setTimeout(r, 5));

      expect(rawEvents).toEqual([
        { state: inactiveSymbol },
        { state: loadingSymbol },
        6,
        { state: inactiveSymbol },
      ]);
      expect(values).toEqual([6]);
      expect(pending).toEqual([true, false]);
      expect(errors).toEqual([]);

      rawSub.unsubscribe();
      subscribeSub.unsubscribe();
    });

    it("cancels in-flight pipeValue internal subscription on inactive", async () => {
      const active = new BehaviorSubject(true);
      let fetchSubscribed = 0;
      let fetchCancelled = 0;

      const store = statefulObservable({
        input: new BehaviorSubject(1),
        active,
      }).pipeValue(
        delay(1),
        mergeMap(
          () =>
            new Observable<number>(() => {
              fetchSubscribed++;
              return () => {
                fetchCancelled++;
              };
            }),
        ),
      );

      const events: ResponseWithStatus<number, unknown>[] = [];
      const sub = store.raw$.subscribe((event) => events.push(event));

      await new Promise((r) => setTimeout(r, 5));
      expect(fetchSubscribed).toEqual(1);
      expect(fetchCancelled).toEqual(0);

      active.next(false);
      await new Promise((r) => setTimeout(r, 5));

      expect(fetchCancelled).toEqual(1);
      expect(events).toEqual([
        { state: loadingSymbol },
        { state: inactiveSymbol },
      ]);

      sub.unsubscribe();
    });

    it("cancels in-flight pipeError internal subscription on inactive", async () => {
      const active = new BehaviorSubject(true);
      let fetchSubscribed = 0;
      let fetchCancelled = 0;

      const store = statefulObservable({
        input: new BehaviorSubject(1),
        active,
        loader: () => throwError(() => "err-cancel"),
      }).pipeError(
        delay(1),
        mergeMap(
          () =>
            new Observable<string>(() => {
              fetchSubscribed++;
              return () => {
                fetchCancelled++;
              };
            }),
        ),
      );

      const events: ResponseWithStatus<number, unknown>[] = [];
      const sub = store.raw$.subscribe((event) => events.push(event));

      await new Promise((r) => setTimeout(r, 5));
      expect(fetchSubscribed).toEqual(1);
      expect(fetchCancelled).toEqual(0);

      active.next(false);
      await new Promise((r) => setTimeout(r, 5));

      expect(fetchCancelled).toEqual(1);
      expect(events).toEqual([
        { state: loadingSymbol },
        { state: inactiveSymbol },
      ]);

      sub.unsubscribe();
    });
  });

  describe("error handling", () => {
    it("input with error - raw", async () => {
      const store = statefulObservable({
        input: of("something").pipe(
          switchMap(() => {
            throw "err";
          }),
        ),
      });

      const res = await firstValueFrom(store.raw$);

      expect(res).toEqual({ state: errorSymbol, error: "err" });
    });
  });

  describe("reload", () => {
    it("reload triggers new request without changing input", async () => {
      let counter = 0;
      const store = statefulObservable({
        input: new BehaviorSubject(1),
        loader: (value) => of([value, ++counter]),
      });

      // first request triggered by subscribing to value
      const first = await firstValueFrom(store.value$);
      expect(first).toEqual([1, 1]);

      // trigger reload explicitly and expect a new request
      store.reload();
      await new Promise((r) => setTimeout(r, 5)); // wait for async operations
      const second = await firstValueFrom(store.value$);
      expect(second).toEqual([1, 2]);
    });

    it("reload triggers new request without changing input - raw values", async () => {
      let counter = 0;
      const store = statefulObservable({
        input: new BehaviorSubject(1),
        loader: (value) => of([value, ++counter] as [number, number]),
      });

      const results: ResponseWithStatus<[number, number], unknown>[] = [];
      store.raw$.subscribe((val) => {
        results.push(val);
      });

      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      // trigger reload explicitly and expect a new request
      store.reload();
      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      expect(results).toEqual([
        { state: loadingSymbol },
        [1, 1],
        { state: loadingSymbol },
        [1, 2],
      ]);
    });
  });

  describe("recovery", () => {
    it("new input triggers new request after error - raw", async () => {
      let counter = 0;
      const input = new BehaviorSubject(1);
      const store = statefulObservable({
        input,
        loader: (value) => {
          if (counter === 0) {
            counter++;
            return throwError(() => "err7");
          }
          return of([value, ++counter] as [number, number]);
        },
      });

      const results: ResponseWithStatus<[number, number], unknown>[] = [];
      store.raw$.subscribe((val) => {
        results.push(val);
      });

      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      // trigger reload explicitly and expect a new request
      input.next(1);
      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      expect(results).toEqual([
        { state: loadingSymbol },
        { state: errorSymbol, error: "err7" },
        { state: loadingSymbol },
        [1, 2],
      ]);
    });

    it("reload triggers new request after error - raw", async () => {
      let counter = 0;
      const store = statefulObservable({
        input: new BehaviorSubject(1),
        loader: (value) => {
          if (counter === 0) {
            counter++;
            return throwError(() => "err8");
          }
          return of([value, ++counter] as [number, number]);
        },
      });

      const results: ResponseWithStatus<[number, number], unknown>[] = [];
      store.raw$.subscribe((val) => {
        results.push(val);
      });

      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      // trigger reload explicitly and expect a new request
      store.reload();
      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      expect(results).toEqual([
        { state: loadingSymbol },
        { state: errorSymbol, error: "err8" },
        { state: loadingSymbol },
        [1, 2],
      ]);
    });
  });

  describe("cache", () => {
    let makeRequestMock = jest.fn(
      (value: number): Observable<number> =>
        defer(() => of(value).pipe(delay(1))),
    );

    beforeEach(() => {
      makeRequestMock = jest.fn(
        (value: number): Observable<number> =>
          defer(() => of(value).pipe(delay(1))),
      );
    });

    it("validate mock", async () => {
      expect(await firstValueFrom(makeRequestMock(1))).toEqual(1);

      expect(makeRequestMock.mock.calls.length).toEqual(1);
    });

    it("validate mock 2", async () => {
      const sourceInput = new BehaviorSubject(1);
      const store = statefulObservable({
        input: sourceInput,
        cacheKey: (input) => [input],
        loader: (input) => defer(() => of(input).pipe(delay(1))),
      });

      expect(await firstValueFrom(store.value$)).toEqual(1);
    });

    it("use internal cache if cacheKey provided", async () => {
      const sourceInput = new BehaviorSubject(1);
      const store = statefulObservable({
        input: sourceInput,
        cacheKey: (input) => [input],
        loader: (input) => makeRequestMock(input),
      }).pipe(shareReplay(1));

      expect(await firstValueFrom(store.value$)).toEqual(1);
      expect(makeRequestMock.mock.calls.length).toEqual(1);

      sourceInput.next(2);
      expect(await firstValueFrom(store.value$)).toEqual(2);
      expect(makeRequestMock.mock.calls.length).toEqual(2);

      sourceInput.next(1);
      expect(await firstValueFrom(store.value$)).toEqual(1);
      expect(makeRequestMock.mock.calls.length).toEqual(2);

      sourceInput.next(2);
      expect(await firstValueFrom(store.value$)).toEqual(2);
      expect(makeRequestMock.mock.calls.length).toEqual(2);
    });

    it("reset internal cache on reload", async () => {
      const sourceInput = new BehaviorSubject(1);
      const store = statefulObservable({
        input: sourceInput,
        cacheKey: (input) => [input],
        loader: (input) => makeRequestMock(input),
      }).pipe(shareReplay(1));

      expect(await firstValueFrom(store.value$)).toEqual(1);
      expect(makeRequestMock.mock.calls.length).toEqual(1);

      sourceInput.next(2);
      expect(await firstValueFrom(store.value$)).toEqual(2);
      expect(makeRequestMock.mock.calls.length).toEqual(2);

      store.reload();

      expect(await firstValueFrom(store.value$)).toEqual(2);
      expect(makeRequestMock.mock.calls.length).toEqual(3);

      sourceInput.next(1);
      expect(await firstValueFrom(store.value$)).toEqual(1);
      expect(makeRequestMock.mock.calls.length).toEqual(4);
    });
  });
});
