import {
    filter,
    map, Observable
} from "rxjs";

import { pipeError, pipeRaw, pipeValue } from "./operators";
import { isError, isLoading, isSuccess } from "./response-container";
import { fillStatefulObservable } from "./statefulObservable";
import {
    PipeErrorOperator,
    PipeRawOperator,
    PipeValueOperator,
    ResponseWithStatus,
    StatefulObservableRaw,
    StatefulObservableStreams,
} from "./types";

/**
 * Splits a stream of ResponseWithStatus into separate, typed streams for raw responses, successful values, errors, and pending state.
 *
 * @template Result - Type of the successful result payload carried by ResponseWithStatus.
 * @template Error - Type of the error payload carried by ResponseWithStatus.
 *
 * @param raw - Source Observable that emits ResponseWithStatus<Result, Error> items.
 *
 * @returns An object of type StatefulObservableStreams<Result, Error> containing:
 *  - raw: the original source Observable (unchanged),
 *  - value: a cached Observable that emits only successful ResponseWithStatus items (filtered by isSuccess),
 *  - error: an Observable that emits only the error payloads extracted from error responses (filtered by isError and mapped to e.error),
 *  - pending: an Observable that emits booleans representing the loading state (mapped via isLoading).
 *
 * @remarks
 * All streams are created from a cached version of the source raw stream (via `defaultCache()`), so late subscribers receive the latest successful emission. The `value`, `error`, and `pending` streams are derived directly from the incoming source.
 */
export const splitResponseWithStatus = <Result, Error>(
  raw: Observable<ResponseWithStatus<Result, Error>>
): StatefulObservableStreams<Result, Error> => ({
  value$: raw.pipe(filter(isSuccess)),
  error$: raw.pipe(
    filter(isError),
    map((e) => e.error)
  ),
  pending$: raw.pipe(map(isLoading)),
});

/**
 * Returns an object containing pipe functions for a given `StatefulObservableForPipe`.
 *
 * The returned object includes:
 * - `pipe`: Applies a sequence of RxJS operator functions to the raw observable.
 * - `pipeValue`: Applies operator functions to the value stream of the observable.
 * - `pipeError`: Applies operator functions to the error stream of the observable.
 *
 * @typeParam Result - The type of the value emitted by the observable.
 * @typeParam Error - The type of the error emitted by the observable.
 * @param statefulObservable - The stateful observable to create pipe functions for.
 * @returns An object with `pipe`, `pipeValue`, and `pipeError` functions.
 */
export const getChaining = <Result, Error>({
  raw$: raw,
  reload,
}: StatefulObservableRaw<Result, Error>) => ({
  pipe: (...args: Parameters<PipeRawOperator>) =>
    fillStatefulObservable(raw.pipe(pipeRaw(...args)), reload),
  pipeValue: (...args: Parameters<PipeValueOperator>) =>
    fillStatefulObservable(raw.pipe(pipeValue(...args)), reload),
  pipeError: (...args: Parameters<PipeErrorOperator>) =>
    fillStatefulObservable(raw.pipe(pipeError(...args)), reload),
});
