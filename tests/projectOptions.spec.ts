import { BehaviorSubject, Observable, of, Subject } from "rxjs";
import { statefulObservableFactory } from "../src/factory";

/** A loader whose requests stay pending until settled by hand. */
const controlledLoader = () => {
  const requests: string[] = [];
  const responses: {
    readonly id: string;
    readonly response: Subject<string>;
  }[] = [];
  const loader = (id: string): Observable<string> =>
    new Observable<string>((subscriber) => {
      requests.push(id);
      const response = new Subject<string>();
      responses.push({ id, response });
      const subscription = response.subscribe(subscriber);
      return () => subscription.unsubscribe();
    });
  const settle = (id: string) => {
    const latest = responses.filter((r) => r.id === id).at(-1)?.response;
    latest?.next(`value ${id}`);
    latest?.complete();
  };
  return { requests, loader, settle };
};

type Line = { readonly sku: string; readonly qty: number };

describe("statefulObservableFactory.project options", () => {
  it("shows a repeated key once", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const ids$ = new BehaviorSubject("a");

    const values: string[] = [];
    const subscription = factory.project(ids$).subscribe((v) => values.push(v));
    settle("a");
    ids$.next("a");

    expect(requests).toEqual(["a"]);
    expect(values).toEqual(["value a"]);
    subscription.unsubscribe();
  });

  it("selects the input of a value with key", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });

    const values: string[] = [];
    const subscription = factory
      .project(of<Line>({ sku: "a", qty: 1 }), { key: (line) => line.sku })
      .subscribe((v) => values.push(v));
    settle("a");

    expect(requests).toEqual(["a"]);
    expect(values).toEqual(["value a"]);
    subscription.unsubscribe();
  });

  it("combines the response with the value it was loaded for", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const line$ = new BehaviorSubject<Line>({ sku: "a", qty: 1 });
    const stream = factory.project(line$, {
      key: (line) => line.sku,
      combine: (price, line) => `${price} x${line.qty}`,
    });

    const events: string[] = [];
    const subscription = stream.raw$.subscribe((e) =>
      events.push(typeof e === "string" ? e : "loading"),
    );
    settle("a");
    // the same key: no request, no loading
    line$.next({ sku: "a", qty: 3 });
    // another key: loading until it arrives, never a mixed value
    line$.next({ sku: "b", qty: 5 });
    settle("b");

    expect(requests).toEqual(["a", "b"]);
    expect(events).toEqual([
      "loading",
      "value a x1",
      "value a x3",
      "loading",
      "value b x5",
    ]);
    subscription.unsubscribe();
  });

  it("turns a throw in combine into an error event and recovers on the next value", () => {
    const { requests, loader, settle } = controlledLoader();
    const factory = statefulObservableFactory({ loader });
    const line$ = new BehaviorSubject<Line>({ sku: "a", qty: 0 });
    const stream = factory.project(line$, {
      key: (line) => line.sku,
      combine: (price: string, line: Line) => {
        if (line.qty === 0) throw "no qty";
        return `${price} x${line.qty}`;
      },
    });

    const errors: unknown[] = [];
    const values: string[] = [];
    const errorSubscription = stream.error$.subscribe((e) => errors.push(e));
    const valueSubscription = stream.value$.subscribe((v) => values.push(v));
    settle("a");
    line$.next({ sku: "a", qty: 2 });

    expect(requests).toEqual(["a"]);
    expect(errors).toEqual(["no qty", false]);
    expect(values).toEqual(["value a x2"]);
    errorSubscription.unsubscribe();
    valueSubscription.unsubscribe();
  });

  it("requires key when the values are not inputs", () => {
    const factory = statefulObservableFactory({
      loader: controlledLoader().loader,
    });
    const line$ = of<Line>({ sku: "a", qty: 1 });
    const typeOnly = () => {
      // @ts-expect-error a value that is not an input needs a key
      factory.project(line$);
      // @ts-expect-error a value that is not an input needs a key
      factory.project(line$, { combine: (price) => price });
    };
    expect(typeOnly).toBeTypeOf("function");
  });
});
