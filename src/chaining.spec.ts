import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';
import {
  delay,
  map, shareReplay,
  switchMap,
  take,
  toArray
} from 'rxjs/operators';
import { fillStatefulObservable } from './chaining';
import { errorSymbol, loadingSymbol } from './response-container';
import { statefulObservable } from './statefulObservable';
import { ResponseWithStatus } from './types';

describe('chaining / fillStatefulObservable', () => {
  describe('basic', () => {
    it('exposes raw, value, error and pending streams', async () => {
      const raw$ = of({ state: loadingSymbol }, 'ok');

      const so = fillStatefulObservable(raw$, () => {});

      const rawValues = await firstValueFrom(so.raw$.pipe(take(2), toArray()));
      expect(rawValues).toEqual([{ state: loadingSymbol }, 'ok']);

      const value = await firstValueFrom(so.value$);
      expect(value).toEqual('ok');

      const err = await firstValueFrom(so.error$);
      expect(err).toEqual(false);

      const pending = await firstValueFrom(
        so.pending$.pipe(take(2), toArray()),
      );
      // last emission of pending for this raw is false (since 'ok' is success)
      expect(pending).toEqual([true, false]);
    });

    it('pipeValue transforms successful values', async () => {
      const raw$ = of({ state: loadingSymbol }, 'a');
      const so = fillStatefulObservable(raw$, () => {});

      const piped = so.pipeValue(map((v: string) => v + '!') as any);
      const value = await firstValueFrom(piped.value$);
      expect(value).toEqual('a!');
    });

    it('pipeError transforms error values and preserves non-error emissions', async () => {
      const raw$ = of(
        { state: loadingSymbol },
        { state: errorSymbol, error: 'err1' },
      );
      const so = fillStatefulObservable(raw$, () => {});

      const transformed = so.pipeError(map((e: any) => e + 'X') as any);

      const err = await firstValueFrom(transformed.error$);
      expect(err).toEqual('err1X');
    });
  });

  describe('pipeValue', () => {
    it('sync', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      }).pipeValue(map((v) => v + 10));
      const res = await firstValueFrom(store.value$);

      expect(res).toEqual(11);
    });

    it('async', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      }).pipeValue(
        switchMap((v) => of(v + 10)),
        delay(1),
      );

      const res = await firstValueFrom(store.value$);

      expect(res).toEqual(11);
    });

    it('basic', async () => {
      const input = new Subject<number>();
      const store = statefulObservable({
        input,
      });
      store.value$.subscribe()

      const piped = store.pipeValue(
        map((v) => 'piped ' + v),
      );

      input.next(1);

      const pipedRes = await firstValueFrom(piped.value$);

      expect(pipedRes).toEqual('piped 1');
    });

    it('long', async () => {
      const input = new Subject<number>();
      const store = statefulObservable({
        input,
      });
      store.value$.subscribe()

      const piped = store.pipeValue(
        map((v) => v.toString()),
        map((v) => +v),
        map((v) => v.toString()),
        map((v) => +v),
        map((v) => v.toString()),
        map((v) => +v),
        map((v) => v.toString()),
        map((v) => +v),
        map((v) => 'piped ' + v),
      );

      input.next(1);

      const pipedRes = await firstValueFrom(piped.value$);

      expect(pipedRes).toEqual('piped 1');
    });
  });

  describe('pipeError', () => {
    it('source raw with error', async () => {
      const store = statefulObservable({
        input: of(1).pipe(
          map(() => {
            throw 'err2';
          }),
        ),
      }).pipeError(map((e) => e + '1'));

      const res = await firstValueFrom(store.raw$.pipe(take(1), toArray()));

      expect(res).toEqual([{ state: errorSymbol, error: 'err21' }]);
    });

    it('map error', async () => {
      const store = statefulObservable({
        input: of('something').pipe(switchMap(() => throwError(() => 'err6'))),
      }).pipeError(map(() => 'err6' as const));

      const res = await firstValueFrom(store.error$);

      expect(res).toEqual('err6');
    });

    it('map error with different types', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      }).pipeValue(
        switchMap((value) => {
          throw value.toString();
        }),
      );

      const storeWithErrorHandling = store.pipeError(
        map((error, input) => {
          if (error === '1') return 1;
          if (error === '2') return 2;
          return error;
        }),
      );

      const res = await firstValueFrom(store.error$);
      expect(res).toEqual('1');

      const res2 = await firstValueFrom(storeWithErrorHandling.error$);
      expect(res2).toEqual(1);
    });
  });

  describe('error handling', () => {
    it('pipeValue raw with sync error', async () => {
      const store = statefulObservable({
        input: of('something'),
      }).pipeValue(switchMap(() => throwError(() => 'err3')));

      const res = await firstValueFrom(store.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([
        { state: loadingSymbol },
        { state: errorSymbol, error: 'err3' },
      ]);
    });

    it('pipeValue raw with async error', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      }).pipeValue(
        delay(1),
        switchMap(() => throwError(() => 'err5')),
      );

      const res = await firstValueFrom(store.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([
        { state: loadingSymbol },
        { state: errorSymbol, error: 'err5' },
      ]);
    });

    it('pass error into separate observable', async () => {
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      }).pipeValue(switchMap(() => throwError(() => 'err5')));

      const res = await firstValueFrom(store.error$);

      expect(res).toEqual('err5');
    });
  });

  describe('reload', () => {
    it('reload triggers new request without changing input', async () => {
      let counter = 0;
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      })
        .pipeValue(
          switchMap((value) => of([value, ++counter])),
          delay(1),
        )
        .pipe(shareReplay(1));

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
      }).pipeValue(
        switchMap((value) => of([value, ++counter] as [number, number])),
        delay(1),
      );

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
    it('reload triggers new request in pipeValue after error - raw', async () => {
      let counter = 0;
      const store = statefulObservable({
        input: new BehaviorSubject(1),
      }).pipeValue(
        switchMap((value) => {
          if (counter === 0) {
            counter++;
            return throwError(() => 'err8');
          }
          return of([value, ++counter] as [number, number]);
        }),
      );

      const results: ResponseWithStatus<[number, number], unknown>[] = [];
      store.raw$.subscribe((val) => {
        results.push(val);
      });

      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      // trigger reload explicitly and expect a new request
      store.reload();
      await new Promise((r) => setTimeout(r, 5)); // wait for async operations

      console.error(results);

      expect(results).toEqual([
        { state: loadingSymbol },
        { state: errorSymbol, error: 'err8' },
        { state: loadingSymbol },
        [1, 2],
      ]);
    });
  });
});
