import {
  BehaviorSubject,
  delay,
  distinctUntilChanged,
  filter,
  map,
  of,
  Subject,
  switchMap,
} from "rxjs";
import { isLoading } from "../src/response-container";
import { statefulObservable } from "../src/statefulObservable";

const settle = () => new Promise((r) => setTimeout(r, 10));
const L = "L";
const show = (event: unknown) => (isLoading(event) ? L : event);

describe("loading only for results that are not synchronous", () => {
  it("a synchronous loader emits the value without loading", () => {
    const raw: unknown[] = [];
    const sub = statefulObservable({ loader: () => of(1) }).raw$.subscribe((e) => raw.push(show(e)));
    expect(raw).toEqual([1]);
    sub.unsubscribe();
  });

  it("an input-only node emits values without loading", () => {
    const input = new Subject<number>();
    const raw: unknown[] = [];
    const sub = statefulObservable(input).raw$.subscribe((e) => raw.push(show(e)));
    input.next(1);
    input.next(2);
    expect(raw).toEqual([1, 2]);
    sub.unsubscribe();
  });

  it("an asynchronous loader still emits loading before the value", async () => {
    const raw: unknown[] = [];
    const sub = statefulObservable({ loader: () => of(1).pipe(delay(1)) }).raw$.subscribe((e) =>
      raw.push(show(e)),
    );
    expect(raw).toEqual([L]);
    await settle();
    expect(raw).toEqual([L, 1]);
    sub.unsubscribe();
  });

  it("a cache hit does not flicker pending$", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({
      input,
      loader: (id: number) => of(id * 10).pipe(delay(1)),
      cacheKey: (id) => [id],
    });
    const pending: boolean[] = [];
    const sub = stream.pending$.subscribe((p) => pending.push(p));
    await settle();
    input.next(2);
    await settle();
    pending.length = 0;

    input.next(1); // cached
    expect(pending).toEqual([false]);
    sub.unsubscribe();
  });

  it("a value dropped inside a pipe keeps the node pending: a change was started", () => {
    const input = new Subject<number>();
    const pending: boolean[] = [];
    const values: number[] = [];
    const node = statefulObservable(input).pipeValue(filter((v) => v > 1));
    const subs = [
      node.pending$.subscribe((p) => pending.push(p)),
      node.value$.subscribe((v) => values.push(v)),
    ];
    input.next(2);
    input.next(1); // dropped by filter inside the pipe
    expect(values).toEqual([2]);
    expect(pending).toEqual([false, true]);
    subs.forEach((s) => s.unsubscribe());
  });

  it("the same filter on the input starts nothing and leaves no pending state", () => {
    const input = new Subject<number>();
    const pending: boolean[] = [];
    const values: number[] = [];
    const node = statefulObservable(input.pipe(filter((v) => v > 1)));
    const subs = [
      node.pending$.subscribe((p) => pending.push(p)),
      node.value$.subscribe((v) => values.push(v)),
    ];
    input.next(2);
    input.next(1); // dropped before the node
    expect(values).toEqual([2]);
    expect(pending).toEqual([false]);
    subs.forEach((s) => s.unsubscribe());
  });

  it("a form projection sends a request only for valid input, with pending only while it runs", async () => {
    const form = new Subject<string>();
    const requests: string[] = [];
    // validation and dedupe on the input, the request in the pipe
    const node = statefulObservable(
      form.pipe(
        map((text) => text.trim()),
        filter((query) => query.length >= 3),
        distinctUntilChanged(),
      ),
    ).pipeValue(
      switchMap((query) => {
        requests.push(query);
        return of(`results for ${query}`).pipe(delay(1));
      }),
    );
    const pending: boolean[] = [];
    const sub = node.pending$.subscribe((p) => pending.push(p));

    form.next("ab"); // too short: no request, no pending
    expect(pending).toEqual([]);
    form.next("abc ");
    await settle();
    form.next("abc"); // same query after trimming: no request, no pending
    await settle();

    expect(requests).toEqual(["abc"]);
    expect(pending).toEqual([true, false]);
    sub.unsubscribe();
  });
});
