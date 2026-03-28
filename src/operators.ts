import {
  MonoTypeOperatorFunction,
  Observable,
  OperatorFunction,
  catchError,
  iif,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs";
import {
  errorSymbol,
  isError,
  isInactive,
  isSuccess,
  loadingSymbol,
} from "./response-container";
import {
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
  ResponseError,
  ResponseLoading,
  ResponseWithStatus,
} from "./types";

/**
 * RxJS operator that catches any error from the upstream observable and
 * converts it into a ResponseError<unknown> value instead of letting the
 * stream error out.
 *
 * The operator leaves successful emissions of type T unchanged. If an error
 * occurs, it emits a single ResponseError<unknown> object constructed as:
 * { state: errorSymbol, error: <caught error> } and completes the stream.
 *
 * Use this when you want to represent errors as stream values (a "stateful"
 * error representation) rather than terminating the observable with an error.
 *
 * @typeParam T - Type of values emitted by the upstream observable.
 * @returns An OperatorFunction that maps Observable<T> to Observable<T | ResponseError<unknown>>.
 *
 * @remarks
 * - The returned observable will never error because upstream errors are
 *   transformed into a value of type ResponseError<unknown>.
 * - The wrapped error is stored in the `error` property of the ResponseError.
 * - The `state` property is set to `errorSymbol` to indicate the error state.
 *
 * @example
 * // source$: Observable<MyData>
 * // source$.pipe(catchResponseError<MyData>()) -> Observable<MyData | ResponseError<unknown>>
 */
export const catchResponseError = <T>(): OperatorFunction<
  T,
  T | ResponseError<unknown>
> =>
  catchError((error) =>
    of<ResponseError<unknown>>({ state: errorSymbol, error: error })
  );

/**
 * Emits a loading sentinel before any values from the source observable.
 *
 * Prepends a ResponseLoading object ({ state: loadingSymbol }) to the stream so
 * subscribers receive an immediate "loading" state and then receive the actual
 * values emitted by the source. This is useful for UI/state management where a
 * loading indicator should be shown until the first real value arrives.
 *
 * @typeParam T - The type of values emitted by the source observable.
 * @returns An RxJS OperatorFunction that emits either a ResponseLoading or values of type T.
 *
 * @example
 * // Emits ResponseLoading first, then the source value(s)
 * source$.pipe(startWithLoading()).subscribe(value => {
 *   // value is ResponseLoading initially, then T values
 * });
 */
export const startWithLoading = <T>(): OperatorFunction<
  T,
  T | ResponseLoading
> => startWith({ state: loadingSymbol } as ResponseLoading);

export const mapToLoading = <T>(): OperatorFunction<T, ResponseLoading> =>
  map(() => ({ state: loadingSymbol } as ResponseLoading));

/**
 * Wrapper for shareReplay with default parameters
 */
export const defaultCache = <T>(refCount = true): MonoTypeOperatorFunction<T> =>
  shareReplay({ bufferSize: 1, refCount });

// helper to apply an array of operator functions to an observable's pipe
export const applyPipe = <T, R = any>(
  obs: Observable<T>,
  operations: OperatorFunction<any, any>[]
): Observable<R> => (obs.pipe as any).apply(obs, operations) as Observable<R>;

export const pipeRaw: PipeRawOperator =
  <Result, Error>(
    ...operations: MonoTypeOperatorFunction<ResponseWithStatus<Result, Error>>[]
  ): MonoTypeOperatorFunction<ResponseWithStatus<Result, Error>> =>
  (raw) =>
    raw.pipe(
      // on new event previous processing chain will be unsubscribed
      switchMap((e) =>
        iif(
          () => isInactive(e),
          // if inactive bypass `inactive` event and cancel operators passed into pipe
          // here might be delay or shareReplay(1) that might prevent putting the reast of chain into inactive state
          of(e),
          applyPipe(of(e), operations).pipe(catchResponseError())
        )
      )
    );

export const pipeValue: PipeValueOperator =
  (...operations: OperatorFunction<any, any>[]) =>
  (raw: Observable<any>) =>
    raw.pipe(
      // on new event previous processing chain will be unsubscribed
      switchMap((e) =>
        iif(
          () => isSuccess(e),
          applyPipe(of(e), operations).pipe(catchResponseError()),
          of(e)
        )
      )
    );

export const pipeError: PipeErrorOperator =
  (...operations: OperatorFunction<any, any>[]) =>
  (raw: Observable<any>) =>
    raw.pipe(
      // on new event previous processing chain will be unsubscribed
      switchMap((e) =>
        iif(
          () => isError(e),
          applyPipe(of(e.error), operations).pipe(
            map(
              (error): ResponseError<Error> => ({ state: errorSymbol, error })
            )
          ),
          of(e)
        )
      )
    );
