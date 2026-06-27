import { BehaviorSubject, map } from "rxjs";
import { combineStatefulObservables } from "../src/combineStatefulObservables";
import { statefulConnection } from "../src/statefulConnection";
import { statefulObservable } from "../src/statefulObservable";
import { Equal, Expect } from "./test.utils";

describe("meta", () => {
  describe("statefulObservable", () => {
    it("returns undefined when meta is not provided", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
      });

      expect(stream.meta).toBeUndefined();
    });

    it("returns provided meta value", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { role: "admin" },
      });

      expect(stream.meta).toEqual({ role: "admin" });
    });

    it("preserves meta through pipeValue", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { tag: "test" },
      }).pipeValue(map((v) => v * 10));

      expect(stream.meta).toEqual({ tag: "test" });
    });

    it("preserves meta through pipeError", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { tag: "test" },
      }).pipeError(map((e: unknown) => String(e)));

      expect(stream.meta).toEqual({ tag: "test" });
    });

    it(".with({ name }) preserves meta", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { id: 42 },
      }).with({ name: "renamed" });

      expect(stream.name).toEqual("renamed");
      expect(stream.meta).toEqual({ id: 42 });
    });

    it(".with({ meta }) changes meta", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { old: true },
      }).with({ meta: { new: true } });

      expect(stream.meta).toEqual({ new: true });
    });

    it(".with({ name, meta }) changes both", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { old: true },
      }).with({ name: "renamed", meta: { new: true } });

      expect(stream.name).toEqual("renamed");
      expect(stream.meta).toEqual({ new: true });
    });
  });

  describe("statefulConnection", () => {
    it("returns undefined when meta is not provided", () => {
      const conn = statefulConnection<number>();

      expect(conn.meta).toBeUndefined();
    });

    it("returns provided meta value", () => {
      const conn = statefulConnection<number, unknown, { role: string }>({
        meta: { role: "admin" },
      });

      expect(conn.meta).toEqual({ role: "admin" });
    });
  });

  describe("combineStatefulObservables", () => {
    it("combined has meta undefined", () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const combined = combineStatefulObservables(
        [s1, s2],
        ([a, b]) => a + b,
      );

      expect(combined.meta).toBeUndefined();
    });
  });

  describe("type inference", () => {
    it("statefulObservable without meta defaults to undefined", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
      });

      type Test = Expect<Equal<typeof stream.meta, undefined>>;
    });

    it("statefulObservable with meta infers the type", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { role: "admin" },
      });

      type Test = Expect<Equal<typeof stream.meta, { role: string }>>;
    });

    it("pipeValue preserves meta type", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { tag: "test" },
      }).pipeValue(map((v) => v * 10));

      type Test = Expect<Equal<typeof stream.meta, undefined>>;
    });

    it("pipeError preserves meta type", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { tag: "test" },
      }).pipeError(map((e: unknown) => String(e)));

      type Test = Expect<Equal<typeof stream.meta, undefined>>;
    });

    it(".with({ meta }) infers new meta type", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { old: true },
      }).with({ meta: { new: true } });

      type Test = Expect<Equal<typeof stream.meta, { new: boolean }>>;
    });

    it(".with({ name, meta }) infers new meta type", () => {
      const stream = statefulObservable({
        input: new BehaviorSubject(1),
        meta: { old: true },
      }).with({ name: "renamed", meta: { new: true } });

      type Test = Expect<Equal<typeof stream.meta, { new: boolean }>>;
    });

    it("statefulConnection without meta defaults to undefined", () => {
      const conn = statefulConnection<number>();

      type Test = Expect<Equal<typeof conn.meta, undefined>>;
    });

    it("statefulConnection with meta infers the type", () => {
      const conn = statefulConnection<number, unknown, { role: string }>({
        meta: { role: "admin" },
      });

      type Test = Expect<Equal<typeof conn.meta, { role: string }>>;
    });

    it("combineStatefulObservables has meta type undefined", () => {
      const s1 = statefulObservable({
        input: new BehaviorSubject(1),
      });
      const s2 = statefulObservable({
        input: new BehaviorSubject(2),
      });

      const combined = combineStatefulObservables(
        [s1, s2],
        ([a, b]) => a + b,
      );

      type Test = Expect<Equal<typeof combined.meta, undefined>>;
    });
  });
});
