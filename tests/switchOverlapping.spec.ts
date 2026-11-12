import { NEVER, Observable, of, Subject } from "rxjs";
import { switchOverlapping } from "../src/operators";

describe("switchOverlapping", () => {
  it("subscribes the new inner stream before releasing the previous one", () => {
    const log: string[] = [];
    const inner = (name: string) =>
      new Observable<string>((subscriber) => {
        log.push(`subscribe ${name}`);
        subscriber.next(name);
        return () => log.push(`release ${name}`);
      });
    const source = new Subject<string>();

    const values: string[] = [];
    const subscription = source
      .pipe(switchOverlapping(inner))
      .subscribe((v) => values.push(v));
    source.next("a");
    source.next("b");
    subscription.unsubscribe();

    expect(log).toEqual([
      "subscribe a",
      "subscribe b",
      "release a",
      "release b",
    ]);
    expect(values).toEqual(["a", "b"]);
  });

  it("passes only the newest inner stream's events", () => {
    const inners = { a: new Subject<string>(), b: new Subject<string>() };
    const source = new Subject<"a" | "b">();

    const values: string[] = [];
    source
      .pipe(switchOverlapping((key: "a" | "b") => inners[key]))
      .subscribe((v) => values.push(v));
    source.next("a");
    source.next("b");
    inners.a.next("late a");
    inners.b.next("b");

    expect(values).toEqual(["b"]);
  });

  it("completes when the source and the newest inner stream have completed", () => {
    let completed = false;
    of(1, 2)
      .pipe(switchOverlapping((n: number) => of(n)))
      .subscribe({ complete: () => (completed = true) });
    expect(completed).toBe(true);

    let pending = true;
    of(1)
      .pipe(switchOverlapping(() => NEVER))
      .subscribe({ complete: () => (pending = false) });
    expect(pending).toBe(true);
  });

  it("forwards errors of the source and of the newest inner stream", () => {
    const errors: unknown[] = [];
    const source = new Subject<number>();
    source
      .pipe(
        switchOverlapping(
          () =>
            new Observable<number>((subscriber) => subscriber.error("inner")),
        ),
      )
      .subscribe({ error: (e: unknown) => errors.push(e) });
    source.next(1);

    const outer = new Subject<number>();
    outer
      .pipe(switchOverlapping(() => NEVER))
      .subscribe({ error: (e: unknown) => errors.push(e) });
    outer.error("outer");

    expect(errors).toEqual(["inner", "outer"]);
  });
});
