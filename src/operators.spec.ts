import { defer, lastValueFrom, of, throwError } from 'rxjs';
import {
  concatMap,
  delay,
  map,
  switchMap,
  toArray
} from 'rxjs/operators';
import {
  catchResponseError,
  defaultCache,
  pipeValue,
  startWithLoading,
} from './operators';
import { errorSymbol, loadingSymbol } from './response-container';

describe('statefulObservable operators', () => {
  describe('catchResponseError', () => {
    it('catchResponseError catches upstream error and emits ResponseError', async () => {
      const src$ = throwError(() => new Error('boom')).pipe(
        catchResponseError(),
      );
      const result = await lastValueFrom(src$);
      expect(result.state).toBe(errorSymbol);
      expect((result as any).error).toBeInstanceOf(Error);
      expect((result as any).error.message).toBe('boom');
    });
  });

  describe('startWithLoading', () => {
    it('startWithLoading emits loading sentinel before source values', async () => {
      const src$ = of('a', 'b').pipe(startWithLoading<string>());
      const arr = await lastValueFrom(src$.pipe(toArray()));
      expect(arr.length).toBe(3);
      expect(arr[0]).toEqual({ state: loadingSymbol });
      expect(arr[1]).toBe('a');
      expect(arr[2]).toBe('b');
    });
  });

  describe('defaultCache', () => {
    it('defaultCache shares a single subscription and replays the last value', async () => {
      let calls = 0;
      const source$ = defer(() => {
        calls++;
        return of('value-' + calls);
      });

      const cached$ = source$.pipe(defaultCache());

      const first = await lastValueFrom(cached$);
      const second = await lastValueFrom(cached$);

      expect(first).toBe('value-1');
      expect(second).toBe('value-1');
      expect(calls).toBe(1);
    });
  });

  describe('pipeValue', () => {
    it('sync', async () => {
      const raw$ = of({ state: loadingSymbol }, 'ok');

      const piped$ = raw$.pipe(pipeValue(map((v: string) => v + '!') as any));

      const arr = await lastValueFrom(piped$.pipe(toArray()));
      expect(arr).toEqual([{ state: loadingSymbol }, 'ok!']);
    });
    it('async', async () => {
      const raw$ = of({ state: loadingSymbol }, 'ok');

      const piped$ = raw$.pipe(
        pipeValue(switchMap((v: string) => of(v + '!').pipe(delay(1))) as any),
      );

      const arr = await lastValueFrom(piped$.pipe(toArray()));
      expect(arr).toEqual([{ state: loadingSymbol }, 'ok!']);
    });
    it('with error', async () => {
      const raw$ = of({ state: loadingSymbol }, 'ok');

      const piped$ = raw$.pipe(
        pipeValue(switchMap((v: string) => throwError(() => 'err'))) as any,
      );

      const arr = await lastValueFrom(piped$.pipe(toArray()));
      expect(arr).toEqual([
        { state: loadingSymbol },
        { state: errorSymbol, error: 'err' },
      ]);
    });
    it('error recovery - validate test', async () => {
      const raw$ = of('not ok', 'ok');

      const piped$ = raw$.pipe(
        concatMap((v: string) =>
          of(v).pipe(
            switchMap((v: string) =>
              v == 'ok' ? of(v + '!') : throwError(() => 'err'),
            ),
            catchResponseError(),
          ),
        ),
      );

      const arr = await lastValueFrom(piped$.pipe(toArray()));
      expect(arr).toEqual([{ state: errorSymbol, error: 'err' }, 'ok!']);
    });
    it('error recovery', async () => {
      const raw$ = of('not ok', 'ok');

      const piped$ = raw$.pipe(
        pipeValue(
          switchMap((v: string) =>
            v == 'ok' ? of(v + '!') : throwError(() => 'err'),
          ),
        ) as any,
      );

      const arr = await lastValueFrom(piped$.pipe(toArray()));
      expect(arr).toEqual([
        { state: errorSymbol, error: 'err' },
        'ok!',
      ]);
    });
  });
});
