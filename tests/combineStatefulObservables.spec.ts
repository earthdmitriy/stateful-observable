import {
  BehaviorSubject,
  delay,
  firstValueFrom,
  map,
  Observable,
  switchMap,
  take,
  throwError,
  toArray,
} from "rxjs";
import { statefulConnection } from "../src";
import { combineStatefulObservables } from "../src/combineStatefulObservables";
import { inactiveSymbol, loadingSymbol } from "../src/response-container";
import { statefulObservable } from "../src/statefulObservable";
import { Equal, Expect } from "./test.utils";

describe("combineStatefulObservables", () => {
  describe("runtime behavior", () => {
    it("combines successful values into a single derived value", async () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const combined = combineStatefulObservables([s1, s2], ([a, b]) => a + b);

      const values: number[] = [];
      combined.value$.subscribe((v) => values.push(v));

      // give combineLatest a tick to settle
      await new Promise((r) => setTimeout(r, 5));

      expect(values).toContain(3);
    });

    it("emits a loading sentinel while any source is loading", async () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const combined = combineStatefulObservables([s1, s2], ([a, b]) => a + b);

      const res: unknown[] = [];
      combined.raw$.subscribe((v) => res.push(v));

      // first emission must be loading
      expect(res[0]).toEqual({ state: loadingSymbol });

      await new Promise((r) => setTimeout(r, 5));
    });

    it("emits an inactive sentinel when any source is inactive", async () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
        active: new BehaviorSubject(false),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const combined = combineStatefulObservables([s1, s2], ([a, b]) => a + b);

      const res = await new Promise<unknown>((resolve) => {
        combined.raw$.subscribe((v) => {
          if (v && (v as { state?: symbol }).state === inactiveSymbol) {
            resolve(v);
          }
        });
      });

      expect(res).toEqual({ state: inactiveSymbol });

      await new Promise((r) => setTimeout(r, 5));
    });

    it("emits an error sentinel with a tuple of source errors", async () => {
      const s1 = statefulObservable<number>({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable<number>({
        input: new BehaviorSubject(2),
      }).pipeValue(
        switchMap((): Observable<number> => throwError(() => "boom")),
      );

      const combined = combineStatefulObservables([s1, s2], ([a]) => a);

      const errors: unknown[] = [];
      combined.error$.subscribe((e) => errors.push(e));

      await new Promise((r) => setTimeout(r, 5));

      expect(errors[errors.length - 1]).toEqual([false, "boom"]);
    });

    it("propagates reload() to every source stream", () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const reload1 = vi.spyOn(s1, "reload");
      const reload2 = vi.spyOn(s2, "reload");

      const combined = combineStatefulObservables([s1, s2], ([a, b]) => a + b);

      combined.reload();

      expect(reload1).toHaveBeenCalledTimes(1);
      expect(reload2).toHaveBeenCalledTimes(1);
    });

    it("works with a single source", async () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(5),
      });

      const combined = combineStatefulObservables([s1], ([a]) => a * 2);

      const value = await new Promise<number>((resolve) => {
        combined.value$.subscribe((v) => resolve(v));
      });

      expect(value).toEqual(10);

      await new Promise((r) => setTimeout(r, 5));
    });

    it("delay", async () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const combined = combineStatefulObservables(
        [s1, s2],
        ([a, b]) => a + b,
      ).pipeValue(delay(1));

      const res = await firstValueFrom(combined.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([{ state: loadingSymbol }, 3]);
    });

    it("delay connection", async () => {
      const s1 = statefulConnection<number>({});
      const s2 = statefulConnection<number>({});

      const combined = combineStatefulObservables(
        [s1, s2],
        ([a, b]) => a + b,
      ).pipeValue(delay(1));
      combined.subscribe(() => 1);

      s1.connect(new BehaviorSubject(1));
      s2.connect(new BehaviorSubject(2));

      const res = await firstValueFrom(combined.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([{ state: loadingSymbol }, 3]);
    });

    it("delay connection2", async () => {
      const s1 = statefulConnection<number>({});
      const s2 = statefulConnection<number>({});

      const combined = combineStatefulObservables(
        [s1, s2],
        ([a, b]) => a + b,
      ).pipeValue(delay(1));

      s1.connect(new BehaviorSubject(1));
      s2.connect(new BehaviorSubject(2));
      combined.subscribe(() => 1);

      const res = await firstValueFrom(combined.raw$.pipe(take(2), toArray()));

      expect(res).toEqual([{ state: loadingSymbol }, 3]);
    });
  });

  describe("type inference", () => {
    it("unwraps tuple element value types inside the map callback", () => {
      const s1 = statefulObservable<number>({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable<string>({
        input: new BehaviorSubject("a"),
      });

      combineStatefulObservables([s1, s2], ([a, b]) => {
        type TestA = Expect<Equal<typeof a, number>>;
        type TestB = Expect<Equal<typeof b, string>>;
        return `${a}-${b}`;
      });
    });

    it("infers the combined value and error tuple types", () => {
      const s1 = statefulObservable<number>({
        input: new BehaviorSubject(1),
      }).pipeError(map((e: unknown) => "e1" as string));
      const s2 = statefulObservable<number>({
        input: new BehaviorSubject(2),
      }).pipeError(map((e: unknown) => 42 as number));

      const combined = combineStatefulObservables([s1, s2], ([a, b]) => a + b);

      type TestValue = Expect<
        Equal<typeof combined.value$, Observable<number>>
      >;
      type TestError = Expect<
        Equal<
          typeof combined.error$,
          Observable<false | [false | string, false | number]>
        >
      >;
    });

    it("works with custom meta types on the sources", () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { x: 1 } as const,
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
        meta: { y: 2 } as const,
      });

      const combined = combineStatefulObservables([s1, s2], ([a, b]) => a + b);

      // combined observable itself has no meta
      type TestMeta = Expect<Equal<typeof combined.meta, undefined>>;
    });
  });
});
