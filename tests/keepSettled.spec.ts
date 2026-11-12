import {
  firstValueFrom,
  Observable,
  of,
  Subject,
  take,
  throwError,
} from "rxjs";
import { keepSettled } from "../src/keepSettled";

/** One microtask, after which a left source is released. */
const released = () => Promise.resolve();

describe("keepSettled", () => {
  it("serves a completed value without loading again", () => {
    let calls = 0;
    const settled: number[] = [];
    const { loader } = keepSettled(
      (n: number) => {
        calls++;
        return of(n * 2);
      },
      () => settled.push(calls),
    );

    const values: number[] = [];
    loader(1).subscribe((v) => values.push(v));
    loader(1).subscribe((v) => values.push(v));

    expect(values).toEqual([2, 2]);
    expect(calls).toBe(1);
    expect(settled).toEqual([1]);
  });

  it("keeps neither an error nor a load that did not complete", async () => {
    let calls = 0;
    const failing = keepSettled(
      () => {
        calls++;
        return throwError(() => "boom");
      },
      () => {},
    );
    failing.loader(1).subscribe({ error: () => {} });
    failing.loader(1).subscribe({ error: () => {} });
    expect(calls).toBe(2);

    const stream = new Subject<number>();
    const streaming = keepSettled(
      () => {
        calls++;
        return stream;
      },
      () => {},
    );
    const subscription = streaming.loader(1).subscribe(() => {});
    stream.next(1);
    subscription.unsubscribe();
    await released();
    streaming.loader(1).subscribe(() => {});
    expect(calls).toBe(4);
  });

  it("lets a load complete when its subscriber leaves inside next", async () => {
    let calls = 0;
    const { loader } = keepSettled(
      () => {
        calls++;
        return Promise.resolve(5);
      },
      () => {},
    );

    expect(await firstValueFrom(loader(1))).toBe(5);
    loader(1)
      .pipe(take(1))
      .subscribe(() => {});
    expect(calls).toBe(1);
  });

  it("cancels a load in flight a microtask after its subscriber leaves", async () => {
    let cancelled = false;
    const { loader } = keepSettled(
      () =>
        new Observable<number>(() => () => {
          cancelled = true;
        }),
      () => {},
    );

    loader(1)
      .subscribe(() => {})
      .unsubscribe();
    expect(cancelled).toBe(false);
    await released();
    expect(cancelled).toBe(true);
  });

  it("forget drops the value, and a load started before it is not kept", () => {
    let calls = 0;
    const response = new Subject<number>();
    const { loader, forget } = keepSettled(
      () => {
        calls++;
        return calls === 1 ? response : of(calls);
      },
      () => {},
    );

    loader(1).subscribe(() => {});
    forget();
    response.next(1);
    response.complete();

    const values: number[] = [];
    loader(1).subscribe((v) => values.push(v));
    expect(values).toEqual([2]);

    forget();
    loader(1).subscribe((v) => values.push(v));
    expect(values).toEqual([2, 3]);
  });
});
