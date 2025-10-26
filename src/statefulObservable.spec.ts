import {
  BehaviorSubject,
  defer,
  delay,
  firstValueFrom,
  map,
  of,
  ReplaySubject,
  shareReplay,
  switchMap,
  take,
  toArray,
} from "rxjs";
import {
  errorSymbol,
  loadingSymbol
} from './response-container';
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
        map((v) => this.process(v))
      )
    )
  );
  store = statefulObservable({
    input: this.input,
  }).pipeValue(switchMap((value) => this.makeRequest(value)));
}

describe("statefulObservable", () => {
  let sampleService: SampleService;
  beforeEach(() => {
    sampleService = new SampleService();
  });

  it("base", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    });

    const res = await firstValueFrom(store.value);

    expect(res).toEqual(1);
  });

  it("base raw", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    });

    const res = await firstValueFrom(store.raw.pipe(take(2), toArray()));

    expect(res).toEqual([{ state: loadingSymbol }, 1]);
  });

  it("pipeValue sync", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    }).pipeValue(map((v) => v + 10));
    const res = await firstValueFrom(store.value);

    expect(res).toEqual(11);
  });

  it("pipeValue async", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    }).pipeValue(
      switchMap((v) => of(v + 10)),
      delay(1)
    );

    const res = await firstValueFrom(store.value);

    expect(res).toEqual(11);
  });

  it("source raw with error", async () => {
    const store = statefulObservable({
      input: of("something").pipe(
        switchMap(() => {
          throw "err";
        })
      ),
    });

    const res = await firstValueFrom(store.raw);

    expect(res).toEqual({ state: errorSymbol, error: "err" });
  });

  it("source raw with error pipe", async () => {
    const store = statefulObservable({
      input: of(1).pipe(
        map(() => {
          throw "err";
        })
      ),
    }).pipeError(map((e) => e + "1"));

    const res = await firstValueFrom(store.raw.pipe(take(1), toArray()));

    console.log(res);

    expect(res).toEqual([{ state: errorSymbol, error: "err1" }]);
  });

  it("pipeValue raw with sync error", async () => {
    const store = statefulObservable({
      input: of("something"),
    }).pipeValue(
      switchMap(() => {
        throw "err";
      })
    );

    const res = await firstValueFrom(store.raw.pipe(take(2), toArray()));

    expect(res).toEqual([
      { state: loadingSymbol },
      { state: errorSymbol, error: "err" },
    ]);
  });

  it("pipeValue raw with async error", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    }).pipeValue(
      delay(1),
      switchMap(() => {
        throw "err";
      })
    );

    const res = await firstValueFrom(store.raw.pipe(take(2), toArray()));

    expect(res).toEqual([
      { state: loadingSymbol },
      { state: errorSymbol, error: "err" },
    ]);
  });

  it("pass error into separate observable", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    }).pipeValue(
      switchMap(() => {
        throw "err";
      })
    );

    const res = await firstValueFrom(store.error);

    expect(res).toEqual("err");
  });

  it("dont keep state without subscribers", async () => {
    sampleService.input.next(1);

    const res = await firstValueFrom(sampleService.store.value);

    expect(sampleService.makeRequest.mock.calls.length).toEqual(1);
    expect(res).toEqual(2);

    const res2 = await firstValueFrom(sampleService.store.value);

    expect(sampleService.makeRequest.mock.calls.length).toEqual(2);
    expect(res2).toEqual(2);
  });

  it("map error", async () => {
    const store = statefulObservable({
      input: of("something").pipe(
        switchMap(() => {
          throw "err";
        })
      ),
    }).pipeError(map(() => "err" as const));

    const res = await firstValueFrom(store.error);

    expect(res).toEqual("err");
  });

  it("map error with different types", async () => {
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    }).pipeValue(
      switchMap((value) => {
        throw value.toString();
      })
    );

    const storeWithErrorHandling = store.pipeError(
      map((error, input) => {
        if (error === "1") return 1;
        if (error === "2") return 2;
        return error;
      })
    );

    const res = await firstValueFrom(store.error);
    expect(res).toEqual("1");

    const res2 = await firstValueFrom(storeWithErrorHandling.error);
    expect(res2).toEqual(1);
  });

  it("pipeValue", async () => {
    const piped = sampleService.store.pipeValue(map((v) => "piped " + v));

    sampleService.input.next(1);

    const pipedRes = await firstValueFrom(piped.value);

    expect(pipedRes).toEqual("piped 2");
  });

  it("pipeValue long", async () => {
    const piped = sampleService.store.pipeValue(
      map((v) => v.toString()),
      map((v) => +v),
      map((v) => v.toString()),
      map((v) => +v),
      map((v) => v.toString()),
      map((v) => +v),
      map((v) => v.toString()),
      map((v) => +v),
      map((v) => "piped " + v)
    );

    sampleService.input.next(1);

    const pipedRes = await firstValueFrom(piped.value);

    expect(pipedRes).toEqual("piped 2");
  });

  it("reload triggers new request without changing input", async () => {
    let counter = 0;
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    })
      .pipeValue(
        switchMap((value) => of([value, ++counter])),
        delay(1)
      )
      .pipe(shareReplay(1));

    // first request triggered by subscribing to value
    const first = await firstValueFrom(store.value);
    expect(first).toEqual([1, 1]);

    // trigger reload explicitly and expect a new request
    store.reload();
    await new Promise((r) => setTimeout(r, 5)); // wait for async operations
    const second = await firstValueFrom(store.value);
    expect(second).toEqual([1, 2]);
  });

  it("reload triggers new request without changing input - raw values", async () => {
    let counter = 0;
    const store = statefulObservable({
      input: new BehaviorSubject(1),
    }).pipeValue(
      switchMap((value) => of([value, ++counter] as [number, number])),
      delay(1)
    );

    const results: ResponseWithStatus<[number, number], unknown>[] = [];
    store.raw.subscribe((val) => {
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

  it("pending flips during async operation", async () => {
    // subscribe to pending and collect two emissions: loading then not loading
    const pendingSeq$ = sampleService.store.pending.pipe(take(2), toArray());
    // trigger a request
    sampleService.input.next(1);
    const pendingSeq = await firstValueFrom(pendingSeq$);
    expect(pendingSeq).toEqual([true, false]);
  });
});
