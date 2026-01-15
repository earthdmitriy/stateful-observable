import { of, throwError } from 'rxjs';
import { errorSymbol, loadingSymbol } from './response-container';
import { makeSubscribe } from './subscribable';

describe('makeSubscribe', () => {
  it('returns the observable.subscribe function when called with no arg', () => {
    const obs = of(1);
    const ret = makeSubscribe(obs)();
    expect(typeof ret).toBe('function');
  });

  it('invokes a provided next-function only for success payloads', () => {
    const values = [] as any[];
    const obs = of({ state: loadingSymbol }, 42, {
      state: errorSymbol,
      error: 'bad',
    });

    makeSubscribe(obs)((v) => values.push(v));

    expect(values).toEqual([42]);
  });

  it('calls pending/next/error/complete on the observer object in the right order', () => {
    const calls: string[] = [];
    const obs = of({ state: loadingSymbol }, 'ok', {
      state: errorSymbol,
      error: 'e1',
    });

    makeSubscribe(obs)({
      pending: (p) => calls.push(`pending:${String(p)}`),
      next: (v) => calls.push(`next:${String(v)}`),
      error: (e) => calls.push(`error:${String(e)}`),
      complete: () => calls.push('complete'),
    });

    expect(calls).toEqual([
      'pending:true',
      'next:ok',
      'pending:false',
      'error:e1',
      'pending:false',
      'complete',
    ]);
  });

  it('forwards actual observable errors to observer.error', () => {
    const obs = throwError(() => new Error('boom'));
    const errCalls: any[] = [];

    makeSubscribe(obs)({
      error: (e) => errCalls.push(e),
    });

    expect(errCalls.length).toBeGreaterThan(0);
    expect(String(errCalls[0])).toContain('boom');
  });
});
