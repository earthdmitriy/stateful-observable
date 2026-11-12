import {
  BehaviorSubject,
  finalize,
  Observable,
  of,
  Subject,
  throwError,
} from "rxjs";
import { statefulObservableBatchFactory } from "../src/batchFactory";
import { missingBatchItemError } from "../src/batcher";
import type { StatefulObservable } from "../src/types";

type Item = { readonly id: number; readonly name: string };

const item = (id: number): Item => ({ id, name: `item ${id}` });

/** A loader that answers every batch with the items of its ids, and records the batches. */
const recordingLoader = () => {
  const calls: (readonly number[])[] = [];
  const loader = (ids: readonly number[]): Observable<readonly Item[]> => {
    calls.push(ids);
    return of(ids.map(item));
  };
  return { calls, loader };
};

const watch = <T>(stream: StatefulObservable<T>) => {
  const values: T[] = [];
  const errors: unknown[] = [];
  const subscription = stream.value$.subscribe((v) => values.push(v));
  subscription.add(
    stream.error$.subscribe((e) => {
      if (e !== false) errors.push(e);
    }),
  );
  return { values, errors, subscription };
};

describe("statefulObservableBatchFactory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the ids requested in one tick with one loader call", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
    });

    const a = watch(factory.get(1));
    const b = watch(factory.get(2));
    const c = watch(factory.get(3));
    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([[1, 2, 3]]);
    expect(a.values).toEqual([item(1)]);
    expect(b.values).toEqual([item(2)]);
    expect(c.values).toEqual([item(3)]);
  });

  it("sends an id once, however many streams show it", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
    });

    const a = watch(factory.get(1));
    const b = watch(factory.get(1));
    const p = watch(factory.project(of(1)));
    const q = watch(factory.get(2));

    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([[1, 2]]);
    expect(a.values).toEqual([item(1)]);
    expect(b.values).toEqual([item(1)]);
    expect(p.values).toEqual([item(1)]);
    expect(q.values).toEqual([item(2)]);
  });

  it("counts the window from the first id, without restarting it", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
      batchTime: 10,
    });

    watch(factory.get(1));
    await vi.advanceTimersByTimeAsync(6);
    watch(factory.get(2));
    await vi.advanceTimersByTimeAsync(6); // 12 ms: the first window closed at 10
    watch(factory.get(3));
    expect(calls).toEqual([[1, 2]]);

    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual([[1, 2], [3]]);
  });

  it("splits a batch into calls of at most maxBatchSize ids", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
      maxBatchSize: 2,
    });

    const watched = [1, 2, 3, 4, 5].map((id) => watch(factory.get(id)));
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([[1, 2], [3, 4], [5]]);
    expect(watched.map((w) => w.values)).toEqual(
      [1, 2, 3, 4, 5].map((id) => [item(id)]),
    );
  });

  it("matches ids as strings", async () => {
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly number[]) =>
        of(ids.map((id) => ({ id: String(id), name: `item ${id}` }))),
      idOf: (i) => Number(i.id),
    });
    const stringIds = statefulObservableBatchFactory({
      loader: (ids: readonly string[]) =>
        of(ids.map((id) => ({ id: Number(id) }))),
      idOf: (i) => String(i.id),
    });

    const a = watch(factory.get(7));
    const b = watch(stringIds.get("8"));
    await vi.advanceTimersByTimeAsync(0);

    expect(a.values).toEqual([{ id: "7", name: "item 7" }]);
    expect(b.values).toEqual([{ id: 8 }]);
  });

  it("fails only the ids missing from the response", async () => {
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly number[]) =>
        of(ids.filter((id) => id !== 2).map(item)),
      idOf: (i: Item) => i.id,
    });

    const a = watch(factory.get(1));
    const b = watch(factory.get(2));
    await vi.advanceTimersByTimeAsync(0);

    expect(a.values).toEqual([item(1)]);
    expect(a.errors).toEqual([]);
    expect(b.values).toEqual([]);
    expect(b.errors).toEqual([missingBatchItemError(2)]);
  });

  it("fails every id of a failed batch, and reloads one id on its own", async () => {
    const calls: (readonly number[])[] = [];
    let fail = true;
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly number[]) => {
        calls.push(ids);
        return fail ? throwError(() => "boom") : of(ids.map(item));
      },
      idOf: (i: Item) => i.id,
    });

    const s1 = factory.get(1);
    const a = watch(s1);
    const b = watch(factory.get(2));
    await vi.advanceTimersByTimeAsync(0);

    expect(a.errors).toEqual(["boom"]);
    expect(b.errors).toEqual(["boom"]);

    fail = false;
    s1.reload();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([[1, 2], [1]]);
    expect(a.values).toEqual([item(1)]);
    expect(b.values).toEqual([]);
  });

  it("factory.reload() reloads the entries in one batch", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
    });

    const watched = [1, 2, 3].map((id) => watch(factory.get(id)));
    await vi.advanceTimersByTimeAsync(0);

    factory.reload();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(watched[0].values).toEqual([item(1), item(1)]);
  });

  it("takes an id out of the batch when its consumer leaves before it is sent", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
      batchTime: 10,
    });

    watch(factory.get(1));
    const b = watch(factory.get(2));
    b.subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(10);

    expect(calls).toEqual([[1]]);
  });

  it("sends nothing when every consumer left before the batch was sent", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
    });

    watch(factory.get(1)).subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([]);
  });

  it("cancels a sent batch only when all of its consumers have left", async () => {
    const response = new Subject<readonly Item[]>();
    let cancelled = 0;
    const factory = statefulObservableBatchFactory({
      loader: () => response.pipe(finalize(() => cancelled++)),
      idOf: (i: Item) => i.id,
    });

    const a = watch(factory.get(1));
    const b = watch(factory.get(2));
    await vi.advanceTimersByTimeAsync(0);

    a.subscription.unsubscribe();
    await Promise.resolve(); // a loader is released a microtask later
    expect(cancelled).toBe(0);

    response.next([item(1), item(2)]);
    expect(b.values).toEqual([item(2)]);

    b.subscription.unsubscribe();
    await Promise.resolve();
    expect(cancelled).toBe(1);
  });

  it("updates the ids of every emission of a streaming response", async () => {
    const response = new Subject<readonly Item[]>();
    const factory = statefulObservableBatchFactory({
      loader: () => response,
      idOf: (i: Item) => i.id,
    });

    const a = watch(factory.get(1));
    const b = watch(factory.get(2));
    await vi.advanceTimersByTimeAsync(0);

    response.next([item(1)]);
    response.next([item(2), { id: 1, name: "renamed" }]);
    response.complete();

    expect(a.values).toEqual([item(1), { id: 1, name: "renamed" }]);
    expect(b.values).toEqual([item(2)]);
    expect(b.errors).toEqual([]);
  });

  it("queues nothing while inactive", async () => {
    const { calls, loader } = recordingLoader();
    const active$ = new BehaviorSubject(false);
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
      active: active$,
    });

    const a = watch(factory.get(1));
    const b = watch(factory.get(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([]);

    active$.next(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([[1, 2]]);
    expect(a.values).toEqual([item(1)]);
    expect(b.values).toEqual([item(2)]);
  });

  it("shares entries between get and project, like statefulObservableFactory", async () => {
    const { calls, loader } = recordingLoader();
    const factory = statefulObservableBatchFactory({
      loader,
      idOf: (i: Item) => i.id,
    });

    const id$ = new BehaviorSubject(1);
    const projected = watch(factory.project(id$));
    const direct = factory.get(1);
    expect(factory.get(1)).toBe(direct);
    await vi.advanceTimersByTimeAsync(0);

    id$.next(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([[1], [2]]);
    expect(projected.values).toEqual([item(1), item(2)]);
  });

  it("loads a synchronous loader's items", async () => {
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly number[]) => [ids.map(item)],
      idOf: (i: Item) => i.id,
    });

    const a = watch(factory.get(1));
    await vi.advanceTimersByTimeAsync(0);

    expect(a.values).toEqual([item(1)]);
  });

  it("fails the batch when idOf throws", async () => {
    const factory = statefulObservableBatchFactory({
      loader: (ids: readonly number[]) => of(ids.map(item)),
      idOf: (): number => {
        throw "bad id";
      },
    });

    const a = watch(factory.get(1));
    await vi.advanceTimersByTimeAsync(0);

    expect(a.errors).toEqual(["bad id"]);
  });
});
