import { from, Observable, ObservableInput } from "rxjs";
import { forward } from "./operators";

/**
 * Wraps the loader of a node with one fixed input (a factory entry) so the
 * value of its last load that completed is kept and served to the next
 * subscriber instead of loading again. See docs/adr.md, "Keep settled values
 * in factory entries".
 *
 * - Only a load that completed with a value is kept: not an error, not a
 *   stream that is still emitting, not a load cut off by unsubscribing.
 * - The source is released a microtask after the subscriber leaves, so a
 *   consumer that wants one value (`firstValueFrom`, `take(1)`) and leaves
 *   inside `next` still lets a request complete in the same callback (HTTP,
 *   promises); a load still in flight is cancelled then.
 * - `forget` drops the kept value. A load started before it (a reload, a
 *   logout) cannot store its result afterwards.
 * - `onSettled` runs whenever a value is kept.
 */
export const keepSettled = <Input, Response>(
  loader: (input: Input) => ObservableInput<Response>,
  onSettled: () => void,
): {
  readonly loader: (input: Input) => Observable<Response>;
  readonly forget: () => void;
} => {
  let settled: { readonly value: Response } | undefined;
  // bumped whenever the kept value is dropped
  let generation = 0;
  const forget = () => {
    settled = undefined;
    generation++;
  };
  const keepingLoader = (input: Input): Observable<Response> =>
    new Observable<Response>((subscriber) => {
      if (settled) {
        subscriber.next(settled.value);
        subscriber.complete();
        return;
      }
      const startedAt = generation;
      let last: { readonly value: Response } | undefined;
      const source = from(loader(input)).subscribe({
        ...forward(subscriber, (result: Response) => {
          last = { value: result };
          subscriber.next(result);
        }),
        complete: () => {
          if (last && startedAt === generation) {
            settled = last;
            onSettled();
          }
          subscriber.complete();
        },
      });
      return () => {
        queueMicrotask(() => source.unsubscribe());
      };
    });
  return { loader: keepingLoader, forget };
};
