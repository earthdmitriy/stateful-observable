import {
  BehaviorSubject,
  defer,
  delay,
  firstValueFrom,
  map,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  switchMap,
  take,
  throwError,
  toArray,
} from 'rxjs';
import { errorSymbol, loadingSymbol } from './response-container';
import { statefulObservable } from './statefulObservable';
import { ResponseWithStatus } from './types';

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

describe('statefulObservable', () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await new Promise((r) => setTimeout(r, 5));
  });

  describe('basic', () => {
    it('bypass input', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      });

      const res = await firstValueFrom(store.value$);

      expect(res).toEqual(1);
    });

    it('bypass input raw', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      });

      const res = await firstValueFrom(store.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([{ state: loadingSymbol }, 1]);
    });

    it('dont keep state without subscribers', async () => {
      const sampleService = new SampleService();
      sampleService.input.next(1);

      const res = await firstValueFrom(sampleService.store.value$);

      expect(sampleService.makeRequest.mock.calls.length).toEqual(1);
      expect(res).toEqual(2);

      const res2 = await firstValueFrom(sampleService.store.value$);

      expect(sampleService.makeRequest.mock.calls.length).toEqual(2);
      expect(res2).toEqual(2);
    });

    it('pending flips during async operation', async () => {
      const sampleService = new SampleService();
      // subscribe to pending and collect two emissions: loading then not loading
      const pendingSeq$ = sampleService.store.pending$.pipe(take(2), toArray());
      // trigger a request
      sampleService.input.next(1);
      const pendingSeq = await firstValueFrom(pendingSeq$);
      expect(pendingSeq).toEqual([true, false]);
    });
  });

  describe('error handling', () => {
    it('input with error - raw', async () => {
      const store = statefulObservable({
        input: of('something').pipe(
          switchMap(() => {
            throw 'err';
          }),
        ),
      });

      const res = await firstValueFrom(store.raw$);

      expect(res).toEqual({ state: errorSymbol, error: 'err' });
    });
  });

  describe('reload', () => {
    it('reload triggers new request without changing input', async () => {
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

    it('reload triggers new request without changing input - raw values', async () => {
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

  describe('recovery', () => {
    it('new input triggers new request after error - raw', async () => {
      let counter = 0;
      const input = new BehaviorSubject(1);
      const store = statefulObservable({
        input,
        loader: (value) => {
          if (counter === 0) {
            counter++;
            return throwError(() => 'err7');
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
        { state: errorSymbol, error: 'err7' },
        { state: loadingSymbol },
        [1, 2],
      ]);
    });

    it('reload triggers new request after error - raw', async () => {
      let counter = 0;
      const store = statefulObservable({
        input: new BehaviorSubject(1),
        loader: (value) => {
          if (counter === 0) {
            counter++;
            return throwError(() => 'err8');
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
        { state: errorSymbol, error: 'err8' },
        { state: loadingSymbol },
        [1, 2],
      ]);
    });
  });

  describe('cache', () => {
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

    it('validate mock', async () => {
      expect(await firstValueFrom(makeRequestMock(1))).toEqual(1);

      expect(makeRequestMock.mock.calls.length).toEqual(1);
    });

    it('validate mock 2', async () => {
      const sourceInput = new BehaviorSubject(1);
      const store = statefulObservable({
        input: sourceInput,
        cacheKey: (input) => [input],
        loader: (input) => defer(() => of(input).pipe(delay(1))),
      });

      expect(await firstValueFrom(store.value$)).toEqual(1);
    });

    it('use internal cache if cacheKey provided', async () => {
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

    it('reset internal cache on reload', async () => {
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
