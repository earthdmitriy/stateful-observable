import { defer, lastValueFrom, of, throwError } from 'rxjs';
import { toArray } from 'rxjs/operators';
import {
  catchResponseError,
  defaultCache,
  startWithLoading,
} from './operators';
import { errorSymbol, loadingSymbol } from './response-container';

describe('statefulObservable operators', () => {
  it('catchResponseError catches upstream error and emits ResponseError', async () => {
    const src$ = throwError(() => new Error('boom')).pipe(catchResponseError());
    const result = await lastValueFrom(src$);
    expect(result.state).toBe(errorSymbol);
    expect((result as any).error).toBeInstanceOf(Error);
    expect((result as any).error.message).toBe('boom');
  });

  it('startWithLoading emits loading sentinel before source values', async () => {
    const src$ = of('a', 'b').pipe(startWithLoading<string>());
    const arr = await lastValueFrom(src$.pipe(toArray()));
    expect(arr.length).toBe(3);
    expect(arr[0]).toEqual({ state: loadingSymbol });
    expect(arr[1]).toBe('a');
    expect(arr[2]).toBe('b');
  });

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
