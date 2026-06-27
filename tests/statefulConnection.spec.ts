import {
  BehaviorSubject,
  defer,
  delay,
  firstValueFrom,
  map,
  of,
  take,
  throwError,
  toArray,
} from "rxjs";
import {
  errorSymbol,
  inactiveSymbol,
  loadingSymbol,
} from "../src/response-container";
import { statefulConnection } from "../src/statefulConnection";
import { statefulObservable } from "../src/statefulObservable";
import { ResponseWithStatus } from "../src/types";

describe("statefulConnection", () => {
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

  describe("initial / disconnected", () => {
    it("emits inactive on raw$ and no public events", async () => {
      const conn = statefulConnection<number>();

      const values: number[] = [];
      const errors: unknown[] = [];
      const pending: boolean[] = [];

      const subscribeNext = vi.fn();
      const subscribeError = vi.fn();
      const subscribePending = vi.fn();

      const vSub = conn.value$.subscribe((v) => values.push(v));
      const eSub = conn.error$.subscribe((e) => errors.push(e));
      const pSub = conn.pending$.subscribe((p) => pending.push(p));
      const sSub = conn.subscribe({
        next: subscribeNext,
        error: subscribeError,
        pending: subscribePending,
      });

      const rawFirst = await firstValueFrom(conn.raw$.pipe(take(1)));
      expect(rawFirst).toEqual({ state: inactiveSymbol });

      await new Promise((r) => setTimeout(r, 5));

      expect(values).toEqual([]);
      expect(errors).toEqual([]);
      expect(pending).toEqual([]);
      expect(subscribeNext).not.toHaveBeenCalled();
      expect(subscribeError).not.toHaveBeenCalled();
      expect(subscribePending).not.toHaveBeenCalled();

      vSub.unsubscribe();
      eSub.unsubscribe();
      pSub.unsubscribe();
      sSub.unsubscribe();
    });
  });

  describe("connect StatefulObservable", () => {
    it("forwards loading and value", async () => {
      const source = statefulObservable({
        input: new BehaviorSubject(2),
        loader: (value) => defer(() => of(value * 2).pipe(delay(1))),
      });

      const conn = statefulConnection<number>();
      const rawEvents: ResponseWithStatus<number, unknown>[] = [];
      const pending: boolean[] = [];

      const rawSub = conn.raw$.subscribe((event) => rawEvents.push(event));
      const pendingSub = conn.pending$.subscribe((p) => pending.push(p));

      conn.connect(source);
      await new Promise((r) => setTimeout(r, 10));

      expect(rawEvents).toEqual(
        expect.arrayContaining([{ state: loadingSymbol }, 4]),
      );
      expect(await firstValueFrom(conn.value$)).toEqual(4);
      expect(pending).toEqual(expect.arrayContaining([true, false]));

      rawSub.unsubscribe();
      pendingSub.unsubscribe();
    });

    it("forwards inactive when source becomes inactive", async () => {
      const active = new BehaviorSubject(true);
      const source = statefulObservable({
        input: new BehaviorSubject(1),
        active,
        loader: (value) => defer(() => of(value).pipe(delay(1))),
      });

      const conn = statefulConnection<number>();
      const rawEvents: ResponseWithStatus<number, unknown>[] = [];
      const rawSub = conn.raw$.subscribe((event) => rawEvents.push(event));

      conn.connect(source);
      await new Promise((r) => setTimeout(r, 10));

      active.next(false);
      await new Promise((r) => setTimeout(r, 5));

      expect(rawEvents).toEqual(
        expect.arrayContaining([
          { state: loadingSymbol },
          1,
          { state: inactiveSymbol },
        ]),
      );

      rawSub.unsubscribe();
    });
  });

  describe("connect vanilla Observable", () => {
    it("wraps of(value) with loading then value", async () => {
      const conn = statefulConnection<string>();
      const rawEvents: ResponseWithStatus<string, unknown>[] = [];

      const rawSub = conn.raw$.subscribe((event) => rawEvents.push(event));
      conn.connect(of("ok"));

      expect(rawEvents).toEqual(
        expect.arrayContaining([{ state: loadingSymbol }, "ok"]),
      );
      expect(await firstValueFrom(conn.value$)).toEqual("ok");

      rawSub.unsubscribe();
    });

    it("maps throwError to error$", async () => {
      const conn = statefulConnection<string, string>();
      const rawEvents: ResponseWithStatus<string, string>[] = [];

      conn.error$.subscribe();
      const rawSub = conn.raw$.subscribe((event) => rawEvents.push(event));

      conn.connect(throwError(() => "fail"));

      expect(await firstValueFrom(conn.error$)).toEqual("fail");
      expect(rawEvents).toEqual(
        expect.arrayContaining([
          { state: loadingSymbol },
          { state: errorSymbol, error: "fail" },
        ]),
      );

      rawSub.unsubscribe();
    });
  });

  describe("disconnect", () => {
    it("returns to inactive after value", async () => {
      const conn = statefulConnection<number>();
      conn.connect(of(42));

      expect(await firstValueFrom(conn.value$)).toEqual(42);
      conn.disconnect();

      expect(await firstValueFrom(conn.raw$.pipe(take(1)))).toEqual({
        state: inactiveSymbol,
      });
    });
  });

  describe("reconnect", () => {
    it("switches between StatefulObservable sources", async () => {
      const sourceA = statefulObservable({
        loader: () => of("a"),
      });
      const sourceB = statefulObservable({
        loader: () => of("b"),
      });

      const conn = statefulConnection<string>();
      conn.connect(sourceA);
      expect(await firstValueFrom(conn.value$)).toEqual("a");

      conn.connect(sourceB);
      expect(await firstValueFrom(conn.value$)).toEqual("b");
    });

    it("switches between vanilla sources", async () => {
      const conn = statefulConnection<string>();
      conn.connect(of("first"));
      expect(await firstValueFrom(conn.value$)).toEqual("first");

      conn.connect(of("second"));
      expect(await firstValueFrom(conn.value$)).toEqual("second");
    });
  });

  describe("pipeValue", () => {
    it("transforms values from connected source", async () => {
      const root = statefulConnection<number>();
      const conn = root.pipeValue(map((v) => v * 10));
      root.connect(of(3));

      expect(await firstValueFrom(conn.value$)).toEqual(30);
    });
  });
});
