import { map, of, throwError } from "rxjs";
import { combineStatefulObservables } from "../src/combineStatefulObservables";
import { statefulObservable } from "../src/statefulObservable";

const settle = () => new Promise((r) => setTimeout(r, 10));

const source = (options: { name?: string; failFirst?: number } = {}) => {
  const calls = { count: 0 };
  const source$ = statefulObservable({
    name: options.name,
    loader: () => {
      calls.count++;
      return calls.count <= (options.failFirst ?? 0)
        ? throwError(() => new Error(`fail #${calls.count}`))
        : of(calls.count);
    },
  });
  return { source$, calls };
};

const counts = (...sources: { calls: { count: number } }[]) =>
  sources.map((s) => s.calls.count);

// [[bucket, catalog], user]; the inner combination is reached through a pipe
const makeGraph = (catalogFailFirst = 0) => {
  const bucket = source({ name: "bucket" });
  const catalog = source({ name: "catalog", failFirst: catalogFailFirst });
  const user = source({ name: "user" });
  const inner = combineStatefulObservables(
    [bucket.source$, catalog.source$],
    ([b, c]) => b + c,
  );
  const outer = combineStatefulObservables(
    [inner.pipeValue(map((x) => x * 10)), user.source$],
    ([i, u]) => i + u,
  );
  return { bucket, catalog, user, outer };
};

describe("reload({ path })", () => {
  it("follows source positions through nested combinations and pipes", async () => {
    const { bucket, catalog, user, outer } = makeGraph();
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ path: [0, 1] });
    await settle();

    expect(counts(bucket, catalog, user)).toEqual([1, 2, 1]);
    sub.unsubscribe();
  });

  it("a path to a combined node reloads its whole subtree", async () => {
    const { bucket, catalog, user, outer } = makeGraph();
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ path: [0] });
    await settle();

    expect(counts(bucket, catalog, user)).toEqual([2, 2, 1]);
    sub.unsubscribe();
  });

  it("an empty path is the same as reload()", async () => {
    const { bucket, catalog, user, outer } = makeGraph();
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ path: [] });
    await settle();

    expect(counts(bucket, catalog, user)).toEqual([2, 2, 2]);
    sub.unsubscribe();
  });

  it("reloads nothing for an index out of range or a path deeper than the graph", async () => {
    const { bucket, catalog, user, outer } = makeGraph();
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ path: [5] });
    outer.reload({ path: [-1] });
    outer.reload({ path: [1, 0] }); // position 1 is a root
    await settle();

    expect(counts(bucket, catalog, user)).toEqual([1, 1, 1]);
    sub.unsubscribe();
  });

  it("applies onlyFailed inside the subtree the path reaches", async () => {
    const { bucket, catalog, user, outer } = makeGraph(1);
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ path: [0], onlyFailed: true });
    await settle();

    expect(counts(bucket, catalog, user)).toEqual([1, 2, 1]);
    sub.unsubscribe();
  });

  it("applies where inside the subtree the path reaches", async () => {
    const { bucket, catalog, user, outer } = makeGraph();
    const sub = outer.raw$.subscribe();
    await settle();

    // "user" exists, but not behind position 0
    outer.reload({ path: [0], where: ({ name }) => name === "user" });
    await settle();
    expect(counts(bucket, catalog, user)).toEqual([1, 1, 1]);

    outer.reload({ path: [0], where: ({ name }) => name === "bucket" });
    await settle();
    expect(counts(bucket, catalog, user)).toEqual([2, 1, 1]);
    sub.unsubscribe();
  });

  it("uses the positions of the error tuple as a path", async () => {
    const { bucket, catalog, user, outer } = makeGraph(1);
    const errors: unknown[] = [];
    const sub = outer.error$.subscribe((e) => errors.push(e));
    await settle();

    // the nested error tuple mirrors the graph: [[false, Error], false]
    const last = errors[errors.length - 1];
    expect(last).toEqual([[false, expect.any(Error)], false]);

    const failedPath = (error: unknown): number[] | null => {
      if (!Array.isArray(error)) return error === false ? null : [];
      for (const [i, entry] of error.entries()) {
        const rest = failedPath(entry);
        if (rest) return [i, ...rest];
      }
      return null;
    };
    const path = failedPath(last);
    expect(path).toEqual([0, 1]);

    outer.reload({ path: path ?? [] });
    await settle();

    expect(counts(bucket, catalog, user)).toEqual([1, 2, 1]);
    expect(errors[errors.length - 1]).toBe(false);
    sub.unsubscribe();
  });
});
