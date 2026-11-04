import { map, of, throwError } from "rxjs";
import { combineStatefulObservables } from "../src/combineStatefulObservables";
import { statefulObservable } from "../src/statefulObservable";
import type { ReloadTarget } from "../src/types";

const settle = () => new Promise((r) => setTimeout(r, 10));

const hasTag =
  (tag: string) =>
  ({ meta }: ReloadTarget): boolean =>
    typeof meta === "object" && meta !== null && "tag" in meta && meta.tag === tag;

const source = (options: { tag?: string; name?: string; failFirst?: number }) => {
  const calls = { count: 0 };
  const source$ = statefulObservable({
    name: options.name,
    meta: options.tag ? { tag: options.tag } : undefined,
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

describe("reload({ where })", () => {
  it("reloads only the sources whose meta matches", async () => {
    const products = source({ tag: "products" });
    const user = source({ tag: "user" });
    const combined = combineStatefulObservables(
      [products.source$, user.source$],
      ([a, b]) => a + b,
    );
    const sub = combined.raw$.subscribe();
    await settle();

    combined.reload({ where: hasTag("products") });
    await settle();

    expect(counts(products, user)).toEqual([2, 1]);
    sub.unsubscribe();
  });

  it("finds a match by name through nested combinations and pipes", async () => {
    const a = source({});
    const b = source({});
    const c = source({ name: "catalog" });
    const inner = combineStatefulObservables([a.source$, b.source$], ([x, y]) => x + y);
    const outer = combineStatefulObservables(
      [inner.pipeValue(map((x) => x * 10)), c.source$.pipeValue(map((x) => x + 1))],
      ([x, y]) => x + y,
    );
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ where: ({ name }) => name === "catalog" });
    await settle();

    expect(counts(a, b, c)).toEqual([1, 1, 2]);
    sub.unsubscribe();
  });

  it("a match on a combined node reloads its whole subtree", async () => {
    const a = source({});
    const b = source({});
    const c = source({});
    const basket = combineStatefulObservables([a.source$, b.source$], ([x, y]) => x + y).with({
      name: "basket",
    });
    const outer = combineStatefulObservables([basket, c.source$], ([x, y]) => x + y);
    const sub = outer.raw$.subscribe();
    await settle();

    outer.reload({ where: ({ name }) => name === "basket" });
    await settle();

    expect(counts(a, b, c)).toEqual([2, 2, 1]);
    sub.unsubscribe();
  });

  it("sees meta set with .with() on a derived node", async () => {
    const a = source({});
    const b = source({});
    const derived = a.source$.pipeValue(map((x) => x * 2)).with({ meta: { tag: "derived" } });
    const combined = combineStatefulObservables([derived, b.source$], ([x, y]) => x + y);
    const sub = combined.raw$.subscribe();
    await settle();

    combined.reload({ where: hasTag("derived") });
    await settle();

    expect(counts(a, b)).toEqual([2, 1]);
    sub.unsubscribe();
  });

  it("reloads nothing when nothing matches", async () => {
    const a = source({ tag: "a" });
    const b = source({ tag: "b" });
    const combined = combineStatefulObservables([a.source$, b.source$], ([x, y]) => x + y);
    const sub = combined.raw$.subscribe();
    await settle();

    combined.reload({ where: hasTag("missing") });
    await settle();

    expect(counts(a, b)).toEqual([1, 1]);
    sub.unsubscribe();
  });

  it("composes with onlyFailed: only failed sources that match", async () => {
    const products = source({ tag: "products", failFirst: 1 });
    const user = source({ tag: "user", failFirst: 1 });
    const healthyProducts = source({ tag: "products" });
    const combined = combineStatefulObservables(
      [products.source$, user.source$, healthyProducts.source$],
      ([a, b, c]) => a + b + c,
    );
    const sub = combined.raw$.subscribe();
    await settle();

    combined.reload({ onlyFailed: true, where: hasTag("products") });
    await settle();

    expect(counts(products, user, healthyProducts)).toEqual([2, 1, 1]);
    sub.unsubscribe();
  });

  it("takes the selector from a derived node's own name or meta (readme example)", async () => {
    const products = source({});
    const bucket = source({});
    const productsTag = { area: "products" };
    const catalog$ = products.source$
      .pipeValue(map((x) => x * 2))
      .with({ name: "catalog", meta: productsTag });
    const basket$ = combineStatefulObservables(
      [bucket.source$, catalog$],
      ([b, c]) => b + c,
    );
    const sub = basket$.raw$.subscribe();
    await settle();

    basket$.reload({ where: ({ name }) => name === catalog$.name });
    await settle();
    expect(counts(products, bucket)).toEqual([2, 1]);

    basket$.reload({ where: ({ meta }) => meta === catalog$.meta });
    await settle();
    expect(counts(products, bucket)).toEqual([3, 1]);
    sub.unsubscribe();
  });

  it("applies to a plain root", async () => {
    const a = source({ tag: "a" });
    const sub = a.source$.raw$.subscribe();
    await settle();

    a.source$.reload({ where: hasTag("other") });
    await settle();
    expect(a.calls.count).toBe(1);

    a.source$.reload({ where: hasTag("a") });
    await settle();
    expect(a.calls.count).toBe(2);
    sub.unsubscribe();
  });
});
