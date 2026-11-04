import { BehaviorSubject, of } from "rxjs";
import { statefulObservable } from "../src/statefulObservable";

const collect = (stream: ReturnType<typeof statefulObservable<number, number>>) => {
  const log: string[] = [];
  const subs = [
    stream.error$.subscribe((e) => {
      if (e) log.push("error");
    }),
    stream.subscribe({
      next: (v) => log.push(`next ${v}`),
      complete: () => log.push("complete"),
    }),
  ];
  return { log, unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
};

describe("synchronous throws stay local to one input", () => {
  it("a loader that throws synchronously reports an error and handles the next input", () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({
      input,
      loader: (id: number) => {
        if (id === 1) throw new Error("sync");
        return of(id * 10);
      },
    });
    const { log, unsubscribe } = collect(stream);

    input.next(2);

    expect(log).toEqual(["error", "next 20"]);
    unsubscribe();
  });

  it("a cacheKey that throws reports an error and handles the next input", () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({
      input,
      loader: (id: number) => of(id * 10),
      cacheKey: (id: number) => {
        if (id === 1) throw new Error("key");
        return [id];
      },
    });
    const { log, unsubscribe } = collect(stream);

    input.next(2);

    expect(log).toEqual(["error", "next 20"]);
    unsubscribe();
  });

  it("a key that cannot be encoded (a cycle) reports an error and handles the next input", () => {
    type Node = { id: number; self?: Node };
    const input = new BehaviorSubject<Node>({ id: 1 });
    const cyclic: Node = { id: 1 };
    cyclic.self = cyclic;
    const stream = statefulObservable({
      input,
      loader: (node: Node) => of(node.id * 10),
      cacheKey: (node: Node) => [node],
    });
    const log: string[] = [];
    const subs = [
      stream.error$.subscribe((e) => {
        if (e) log.push("error");
      }),
      stream.subscribe((v) => log.push(`next ${v}`)),
    ];

    input.next(cyclic);
    input.next({ id: 2 });

    expect(log).toEqual(["next 10", "error", "next 20"]);
    subs.forEach((s) => s.unsubscribe());
  });
});
