import { BehaviorSubject, Observable, switchMap, throwError } from "rxjs";
import { statefulObservable } from "./statefulObservable";
import { combineStatefulObservables } from "./utils";

describe("fallback logging", () => {
  let consoleErrorSpy: jest.SpyInstance<
    void,
    [message?: any, ...optionalParams: any[]],
    any
  >;

  beforeEach(() => {
    // Spy on console.error and suppress the actual output
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore the original console.error implementation
    consoleErrorSpy.mockRestore();
  });

  it("error being logged with console.error", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable<number, unknown>({
      input,
      loader: (value) => {
        return throwError(() => "err");
      },
    });

    const results: number[] = [];
    stream.subscribe({
      next: (val) => {
        results.push(val as number);
      },
    });

    expect(results).toEqual([]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Unhandled error in statefulObservable 'unnamed #0'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:",
      "err",
    );
  });

  it("error being logged with console.error on chained observable", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable<number, unknown>({
      input,
      loader: (value) => {
        return throwError(() => "err");
      },
    });

    const node1 = stream.pipeError();
    const node2 = node1.pipeValue();

    const results: number[] = [];
    node2.subscribe({
      next: (val) => {
        results.push(val as number);
      },
    });

    expect(results).toEqual([]);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

    expect(consoleErrorSpy).toHaveBeenNthCalledWith(
      1,
      "Unhandled error in statefulObservable 'unnamed #0'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:",
      "err",
    );
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(
      2,
      "Unhandled error in statefulObservable 'unnamed #1'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:",
      "err",
    );
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(
      3,
      "Unhandled error in statefulObservable 'unnamed #2'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:",
      "err",
    );
  });

  it("error not being logged with console.error if error$ is subscribed", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable({
      input,
      loader: (value): Observable<number> => throwError(() => "err"),
    });

    // Subscribe to error$ to prevent logging
    stream.error$.subscribe();

    const results: number[] = [];
    stream.subscribe({
      next: (val) => {
        results.push(val);
      },
    });

    expect(results).toEqual([]);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("error not being logged if error$ is subscribed in chained stateful observable", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable<number, unknown>({
      input,
    })
      .pipeValue(
        switchMap((value): Observable<number> => throwError(() => "err")),
      )
      .pipeValue()
      .pipeValue()
      .pipeValue();

    // Subscribe to error$ to prevent logging
    stream.error$.subscribe();

    const results: number[] = [];
    stream.subscribe({
      next: (val) => {
        results.push(val);
      },
    });

    expect(results).toEqual([]);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("error not being logged if error$ is subscribed in combined stateful observable", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable<number, unknown>({
      input,
    }).pipeValue(
      switchMap((value): Observable<number> => throwError(() => "err")),
    );

    const combinedStream = combineStatefulObservables(
      [stream, statefulObservable(() => new BehaviorSubject(2))],
      ([a]) => a,
    );

    // Subscribe to error$ to prevent logging
    combinedStream.error$.subscribe();

    const results: number[] = [];
    combinedStream.subscribe({
      next: (val) => {
        results.push(val);
      },
    });

    expect(results).toEqual([]);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("error being logged if error$ is not subscribed in combined stateful observable", async () => {
    const input = new BehaviorSubject(1);
    const stream = statefulObservable<number, unknown>({
      input,
      name: "TestStream",
    }).pipeValue(
      switchMap((value): Observable<number> => throwError(() => "err")),
    );

    const combinedStream = combineStatefulObservables(
      [
        stream,
        statefulObservable({
          loader: () => new BehaviorSubject(2),
          name: "SecondStream",
        }),
      ],
      ([a]) => a,
    );

    const results: number[] = [];
    combinedStream.subscribe({
      next: (val) => {
        results.push(val);
      },
    });

    expect(results).toEqual([]);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

    expect(consoleErrorSpy).toHaveBeenNthCalledWith(
      1,
      "Unhandled error in statefulObservable 'TestStream #1'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:",
      "err",
    );
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(
      2,
      "Unhandled error in statefulObservable '[TestStream, SecondStream] #0'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:",
      ["err", false],
    );
  });
});
