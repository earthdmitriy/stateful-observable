import { combineLatest, map } from "rxjs";
import { fillStatefulObservable } from "./fillStatefulObservable";
import {
  errorSymbol,
  inactiveSymbol,
  isError,
  isInactive,
  isLoading,
  loadingSymbol,
  metaSymbol,
} from "./response-container";
import {
  MetaInfo,
  ResponseError,
  ResponseInactive,
  ResponseLoading,
  StatefulObservable,
} from "./types";

type UnwrapStatefulObservable<T> = T extends StatefulObservable<infer U>
  ? U
  : never;
type UnwrapStatefulObservables<T extends unknown[]> = T extends []
  ? [] // stop on empty tuple
  : T extends readonly [infer Head, ...infer Tail]
  ? [UnwrapStatefulObservable<Head>, ...UnwrapStatefulObservables<Tail>] // process as tuple
  : T extends StatefulObservable<infer R>[] // process as array
  ? R[]
  : [];

type UnwrapStatefulObservableError<T> = T extends StatefulObservable<
  any,
  infer E
>
  ? false | E
  : never;
type UnwrapStatefulObservablesError<T extends unknown[]> = T extends []
  ? [] // stop on empty tuple
  : T extends [infer Head, ...infer Tail]
  ? [
      UnwrapStatefulObservableError<Head>,
      ...UnwrapStatefulObservablesError<Tail>
    ] // process as tuple
  : T extends StatefulObservable<any, infer E>[] // process as array
  ? E[]
  : [];

/**
 * Combine multiple `StatefulObservable`s into a single derived `StatefulObservable`.
 *
 * The returned stream emits a loading sentinel when any source is loading,
 * emits an inactive sentinel when any source is inactive, and emits an
 * error sentinel when any source reports an error. When all sources are
 * successful the provided `mapCombinedValue` is called with the tuple/array
 * of successful payloads and its result is emitted as the combined value.
 *
 * The combined stream propagates `reload()` calls to all source streams.
 *
 * @template T - Tuple or array of `StatefulObservable` sources. The element
 *   types are unwrapped and passed into `mapCombinedValue`.
 * @template Result - The result type produced by `mapCombinedValue`.
 * @param args - An array/tuple of `StatefulObservable` instances to combine.
 * @param mapCombinedValue - A pure mapping function that receives the
 *   unwrapped successful values from each source and returns the combined
 *   result. This function is only called when none of the sources are
 *   loading/error/inactive.
 * @returns A `StatefulObservable<Result, UnwrapStatefulObservablesError<T>>`
 *   that represents the combined state of the input streams.
 *
 * @example
 * const combined = combineStatefulObservables(
 *   [usersStream, permissionsStream],
 *   ([users, permissions]) => ({ users, permissions })
 * );
 */
export const combineStatefulObservables = <
  T extends [...StatefulObservable[]],
  Result
>(
  args: [...T],
  mapCombinedValue: (data: UnwrapStatefulObservables<T>) => Result
): StatefulObservable<Result, UnwrapStatefulObservablesError<T>> => {
  const meta = args.flatMap((a) => a[metaSymbol] as MetaInfo[]);

  return fillStatefulObservable({
    raw: combineLatest(args.map((s) => s.raw$)).pipe(
      map((events) => {
        if (events.some((x) => isInactive(x)))
          return { state: inactiveSymbol } as ResponseInactive;
        if (events.some((x) => isLoading(x)))
          return { state: loadingSymbol } as ResponseLoading;
        if (events.some((x) => isError(x)))
          return {
            state: errorSymbol,
            error: events.map((x) => (isError(x) ? x.error : false)),
          } as ResponseError<UnwrapStatefulObservablesError<T>>;
        return mapCombinedValue(events as UnwrapStatefulObservables<T>);
      })
    ),
    name: `[${args.map(({ name }) => name).join(", ")}]`,
    meta,
    index: -1, // will be incremented to 0 in fillStatefulObservable
    reload: () => args.forEach((stream) => stream.reload()),
    // any refCount: true in sources => projection also refCount: true
    refCount: meta.some((m) => m.refCount),
  });
};
