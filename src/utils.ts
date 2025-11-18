import { combineLatest, map } from "rxjs";
import { fillStatefulObservable } from "./chaining";
import {
  errorSymbol,
  isError,
  isLoading,
  loadingSymbol,
} from "./response-container";
import { ResponseError, ResponseLoading, StatefulObservable } from "./types";

type UnwrapStatefulObservable<T> =
  T extends StatefulObservable<infer U> ? U : never;
type UnwrapStatefulObservables<T extends unknown[]> = T extends []
  ? [] // stop on empty tuple
  : T extends readonly [infer Head, ...infer Tail]
    ? [UnwrapStatefulObservable<Head>, ...UnwrapStatefulObservables<Tail>] // process as tuple
    : T extends StatefulObservable<infer R>[] // process as array
      ? R[]
      : [];

type UnwrapStatefulObservableError<T> =
  T extends StatefulObservable<any, infer E> ? false | E : never;
type UnwrapStatefulObservablesError<T extends unknown[]> = T extends []
  ? [] // stop on empty tuple
  : T extends [infer Head, ...infer Tail]
    ? [
        UnwrapStatefulObservableError<Head>,
        ...UnwrapStatefulObservablesError<Tail>,
      ] // process as tuple
    : T extends StatefulObservable<any, infer E>[] // process as array
      ? E[]
      : [];

export const combineStatefulObservables = <
  T extends [...StatefulObservable[]],
  Result,
>(
  args: [...T],
  mapCombinedValue: (data: UnwrapStatefulObservables<T>) => Result
): StatefulObservable<Result, UnwrapStatefulObservablesError<T>> =>
  fillStatefulObservable(
    combineLatest(args.map((s) => s.raw$)).pipe(
      map((events) => {
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
    () => args.forEach((store) => store.reload())
  );
