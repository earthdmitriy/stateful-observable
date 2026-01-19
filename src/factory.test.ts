import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { statefulObservableFactory } from './factory';

describe('statefulObservableFactory', () => {
  it('reuses statefulObservable instances for the same key (single request)', async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id * 10);
      },
      cacheKey: (i) => [i],
    });

    const s1 = factory.get(1);
    const s2 = factory.get(1);

    // subscribe both - because of sharing there should be only one loader call
    const [v1, v2] = await Promise.all([
      firstValueFrom(s1.value$),
      firstValueFrom(s2.value$),
    ]);

    expect(v1).toBe(10);
    expect(v2).toBe(10);
    expect(calls).toBe(1);
  });

  it('reset(false) clears cached observables without subscribers', async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id + 100);
      },
      cacheKey: (i) => [i],
    });

    // initial subscription
    const s1 = factory.get(2);
    const v = await firstValueFrom(s1.value$);
    expect(v).toBe(102);

    // after firstValueFrom completes there are no active subscribers
    // reset only entries with no subscribers
    factory.reset(false);

    // getting again should create a fresh stream and trigger loader again
    const s2 = factory.get(2);
    const v2 = await firstValueFrom(s2.value$);
    expect(v2).toBe(102);
    expect(calls).toBe(2);
  });

  it('reload triggers reload on all cached observables', async () => {
    let calls = 0;
    const factory = statefulObservableFactory<number, number>({
      loader: (id) => {
        calls++;
        return Promise.resolve(id * 2);
      },
      cacheKey: (i) => [i],
    });

    const s1 = factory.get(3);
    const s2 = factory.get(4);

    // collect two emissions: initial + after reload
    const p1 = firstValueFrom(s1.value$.pipe(take(2), toArray()));
    const p2 = firstValueFrom(s2.value$.pipe(take(2), toArray()));

    // wait a tick for initial values to arrive
    await Promise.all([firstValueFrom(s1.value$), firstValueFrom(s2.value$)]);

    // trigger reload for all cached streams
    factory.reload();

    const res = await Promise.all([p1, p2]);

    // each stream emitted two values (initial + reload)
    expect(res[0].length).toBe(2);
    expect(res[1].length).toBe(2);

    // loader called once per initial subscription + once per reload per stream
    expect(calls).toBe(4);
  });
});
