import {
  MonoTypeOperatorFunction,
  Observable,
  ObservableInput,
  ObservedValueOf,
  Observer,
  OperatorFunction,
  Unsubscribable,
} from "rxjs";
import { errorSymbol, loadingSymbol, metaSymbol } from "./response-container";

export type ResponseLoading = {
  state: typeof loadingSymbol;
};

export type ResponseError<E = unknown> = {
  state: typeof errorSymbol;
  error: E;
};

export type ResponseWithStatus<T, E = unknown> =
  | ResponseLoading
  | ResponseError<E>
  | T;

export type FlatResponseContainer<Value, Error = unknown> =
  | {
      value: Value;
    }
  | {
      error: Error;
    };

export type LogFnWithInput<Input, Response> = (
  value: { input: Input } | FlatResponseContainer<Response>,
  name: string,
  index: number,
) => void;

export type LogFn<Response,Error> = (
  value: FlatResponseContainer<Response, Error>,
  name: string,
  index: number,
) => void;

export type MetaInfo = { errorSubscriptions: number };

export type TmapOperator = <T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O,
) => OperatorFunction<T, ObservedValueOf<O>>;

export type CommonParams<Input, Response> = {
  /**
   * Maximum number of entries to keep in the internal cache. Defaults to the
   * value supplied by the factory (42 in the implementation).
   */
  cacheSize?: number;

  /**
   * Operator used to map input -> response observable. Defaults to `switchMap`.
   * Accepts a project function that returns an ObservableInput and converts it
   * into an operator function compatible with RxJS pipe.
   */
  mapOperator?: TmapOperator;

  /**
   * An optional name for the stateful observable, used for debugging purposes.
   */
  name?: string;

  /**
   * Optional logging hooks called for each value.
   */
  log?: LogFnWithInput<Input, Response>;
};

/**
 * Parameters when an `input` observable is provided.
 *
 * @template Input - type of values produced by the input observable
 * @template Response - type produced by the loader or passed through when no loader is used
 */
export type ParamsWithInput<Input, Response> = CommonParams<Input, Response> & {
  /**
   * Source observable that drives requests/values.
   * When provided, every emission from this observable will be processed
   * by the loader (if present) or passed through as the response.
   */
  input: Observable<Input>;

  /**
   * Optional function that returns a cache key for a given input value.
   * The returned array is joined internally to form a string key. If the
   * function returns a falsy/empty array the caching logic will be skipped
   * for that input.
   */
  cacheKey?: (i: Input) => any[];

  /**
   * Optional loader that maps an input value to an ObservableInput of Response.
   * If omitted the input value itself is used as the response value.
   */
  loader?: (input: Input) => ObservableInput<Response>;
};

/**
 * Parameters when a `loader` function is required but `input` is optional.
 *
 * This variant allows creating a stateful observable that starts from a
 * constant trigger (when `input` is not provided) but still requires a
 * `loader` to produce responses from an input value.
 */
export type ParamsWithLoader<Input, Response> = CommonParams<
  Input,
  Response
> & {
  /**
   * Optional source observable. If omitted the implementation will use a
   * single default trigger (e.g. `of(true as Input)`) so the loader is still
   * invoked when the stateful observable is subscribed/reloaded.
   */
  input?: Observable<Input>;

  /**
   * Optional function that returns a cache key for a given input value.
   * The returned array is joined internally to form a string key. If the
   * function returns a falsy/empty array the caching logic will be skipped
   * for that input.
   */
  cacheKey?: (i: Input) => any[];

  /**
   * Loader function which must be provided for this parameter shape. It maps
   * an input to an ObservableInput of Response. The result will be consumed
   * and cached according to the cache settings.
   */
  loader: (input: Input) => ObservableInput<Response>;
};

export type OnlyInput<Input> = Observable<Input>;
export type OnlyLoader<Response> = () => ObservableInput<Response>;

export type StatefulObservableParams<Input, Response> =
  | OnlyInput<Input>
  | OnlyLoader<Response>
  | ParamsWithInput<Input, Response>
  | ParamsWithLoader<Input, Response>;

/**
 * The minimal "raw" shape returned by the factory that backs the higher-level
 * `StatefulObservable` API.
 *
 * - `raw$` emits the full response union: a loading sentinel, an error value
 *   (`ResponseError<Error>`) or the successful payload of type `T`.
 * - `reload()` triggers re-evaluation of the underlying source/loader (for
 *   example to force a network refetch). Implementations typically push a
 *   value into an internal subject to cause the loader to run again.
 *
 * @template T - successful result type emitted by the stream
 * @template Error - error payload type used for `ResponseError<Error>` emissions
 */
export type StatefulObservableRaw<T = unknown, Error = unknown> = {
  /**
   * Observable that emits {@link ResponseWithStatus} values (loading|error|success).
   *
   * @remarks you should usually prefer `value$` / `error$` / `pending$` streams
   * */
  raw$: Observable<ResponseWithStatus<T, Error>>;

  /**
   * Trigger to manually refresh/reload the current input.
   *
   * @remarks useful for error recovery or force re-evaluation of the loader (and following operators in `pipeValue`) without changing the input.
   * */
  reload: () => void;
};

/**
 * Convenience typed streams derived from the `raw$` stream.
 *
 * - `value$` emits only successful payloads of type `T`.
 * - `error$` emits either `false` (when there is no error) or the error payload
 *   of type `Error` extracted from an error response.
 * - `pending$` emits booleans indicating whether the loader is currently in a
 *   loading state.
 *
 * These streams are intended for direct consumption in views or business logic
 * so subscribers don't need to perform repetitive filtering/mapping of the
 * `raw$` union type.
 *
 * @template T - successful result type
 * @template Error - error payload type
 */
export type StatefulObservableStreams<T = unknown, Error = unknown> = {
  /**
   * Successful values only (filters out loading/error sentinels).
   *
   * Template (async pipe):
   * ```html
   * @if (stream.value$ | async as data) {
   *   <app-data [data]="data"></app-data>
   * }
   * ```
   */
  value$: Observable<T>;

  /**
   * Error payloads or `false` when there is no error.
   *
   * Template (async pipe):
   * ```html
   * @if (stream.error$ | async as error) {
   *   <app-error [error]="error"></app-error>
   * } @else {
   *   @if (stream.value$ | async as data) {
   *     <app-data [data]="data"></app-data>
   *   }
   * }
   */
  error$: Observable<false | Error>;

  /**
   * Boolean loading indicator — `true` while a loader is in-flight.
   *
   * Template (async pipe):
   * ```html
   * <div [class.loading]="stream.pending$ | async">...</div>
   * ```
   */
  pending$: Observable<boolean>;
};

export type ObserverWithPending<T = unknown> = Partial<Observer<T>> & {
  /**
   * A callback function that gets called by the producer during the subscription when
   * the stream's pending state changes.
   */
  pending?: (pending: boolean) => void;
};

export type StatefulObservableSubsribable<T = unknown> = {
  subscribe(observer: Partial<ObserverWithPending<T>>): Unsubscribable;
};

export type StatefulObservableUtils<T = unknown, Error = unknown> = {
  /**
   * Apply a sequence of MonoType operators to the underlying `raw` stream.
   *
   * Use `pipe(...)` when you need to operate on the full ResponseWithStatus
   * union (loading / error / value). Typical use-cases are caching or time-
   * based operators that must observe or preserve the loading/error sentinels
   * (for example `shareReplay`, `debounceTime`, `throttleTime`).
   *
   * IMPORTANT: this method only accepts operators that are "mono-type" for
   * `ResponseWithStatus<T>` (i.e. `MonoTypeOperatorFunction<ResponseWithStatus<T>>`).
   * That means the operator must not change the outer response shape. If you
   * need to transform the successful `T` payload, prefer `pipeValue(...)`.
   *
   * @returns A new `StatefulObservable` that reflects the applied operators.
   */
  pipe(): StatefulObservable<T, Error>;
  pipe(
    ...operations: MonoTypeOperatorFunction<ResponseWithStatus<T>>[]
  ): StatefulObservable<T>;

  /**
   * Operate on successful values only — behaves like `Observable.prototype.pipe`
   * for the `value$` stream.
   *
   * The provided operators receive the successful payload `T` (not the
   * ResponseWithStatus wrapper) and should return transformed values. Errors
   * and loading sentinels are preserved and merged back into the resulting
   * `raw` stream so consumers continue to receive the correct state.
   *
   * Use `pipeValue(...)` for data transformations (mapping, filtering, async
   * mapping of the payload) while keeping the stateful semantics intact.
   */
  pipeValue(): StatefulObservable<T, Error>;
  // omit error type because stream can fail with another error
  pipeValue<A>(op1: OperatorFunction<T, A>): StatefulObservable<A>;
  pipeValue<A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
  ): StatefulObservable<B>;
  pipeValue<A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
  ): StatefulObservable<C>;
  pipeValue<A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
  ): StatefulObservable<D>;
  pipeValue<A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
  ): StatefulObservable<E>;
  pipeValue<A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
  ): StatefulObservable<F>;
  pipeValue<A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
  ): StatefulObservable<G>;
  pipeValue<A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
  ): StatefulObservable<H>;
  pipeValue<A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
  ): StatefulObservable<I>;
  pipeValue<A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
    ...operations: OperatorFunction<any, any>[]
  ): StatefulObservable<unknown>;

  /**
   * Transform error payloads emitted by the `error$` stream.
   *
   * The operators passed to `pipeError(...)` operate on the error payload
   * (type `Error`) and must return a new error payload. The resulting value
   * will be re-wrapped into the error sentinel `{ state: errorSymbol, error }`.
   *
   * Important: operators supplied here MUST NOT throw. Throwing inside an
   * error-mapper may produce a different error shape or will be converted to
   * a ResponseError by the internal `catchResponseError` wrapper — prefer
   * returning a mapped value instead of throwing.
   *
   * Tip: when mapping to different error shapes prefer using small
   * type-guard-based mapper functions so the compiler can narrow the error
   * type reliably. For example, use helpers like `isNotFound(err)` or
   * `isValidationError(err)` inside your operator to choose the mapped value
   * and preserve strong typing across `pipeError` chains.
   */
  pipeError(): StatefulObservable<T, Error>;
  pipeError<A>(op1: OperatorFunction<T, A>): StatefulObservable<T, A>;
  pipeError<A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
  ): StatefulObservable<T, B>;
  pipeError<A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
  ): StatefulObservable<T, C>;
  pipeError<A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
  ): StatefulObservable<T, D>;
  pipeError<A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
  ): StatefulObservable<T, E>;
  pipeError<A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
  ): StatefulObservable<T, F>;
  pipeError<A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
  ): StatefulObservable<T, G>;
  pipeError<A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
  ): StatefulObservable<T, H>;
  pipeError<A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
  ): StatefulObservable<T, I>;
  pipeError<A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
    ...operations: OperatorFunction<any, any>[]
  ): StatefulObservable<T, unknown>;
};

export type StatefulObservableInfo = {
  /**
   * A name for the stateful observable, useful for debugging.
   */
  readonly name: string;
  /**
   * An index number of node that can be used to identify the order of creation
   * among multiple stateful observables.
   */
  readonly index: number;

  readonly [metaSymbol]?: unknown;
};

export type StatefulObservable<
  T = unknown,
  Error = unknown,
> = StatefulObservableRaw<T, Error> &
  StatefulObservableStreams<T, Error> &
  StatefulObservableUtils<T, Error> &
  StatefulObservableSubsribable<T> &
  StatefulObservableInfo;

export type PipeRawOperator = {
  <Result, Error>(
    ...operations: MonoTypeOperatorFunction<ResponseWithStatus<Result, Error>>[]
  ): MonoTypeOperatorFunction<ResponseWithStatus<Result, Error>>;
};

export type PipeValueOperator = {
  <T, Error>(): OperatorFunction<
    ResponseWithStatus<T, Error>,
    ResponseWithStatus<T, Error>
  >;
  <T, A>(
    op1: OperatorFunction<T, A>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<A>>;
  <T, A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<B>>;
  <T, A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<C>>;
  <T, A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<D>>;
  <T, A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<E>>;
  <T, A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<F>>;
  <T, A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<G>>;
  <T, A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<H>>;
  <T, A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<I>>;
  <T, A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
    ...operations: OperatorFunction<any, any>[]
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<unknown>>;
};

export type PipeErrorOperator = {
  <T, Error>(): OperatorFunction<
    ResponseWithStatus<T, Error>,
    ResponseWithStatus<T, Error>
  >;
  <T, Error, A>(
    op1: OperatorFunction<Error, A>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, A>>;
  <T, Error, A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, B>>;
  <T, Error, A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, C>>;
  <T, Error, A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, D>>;
  <T, Error, A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, E>>;
  <T, Error, A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, F>>;
  <T, Error, A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, G>>;
  <T, Error, A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, H>>;
  <T, Error, A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, I>>;
  <T, Error, A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
    ...operations: OperatorFunction<any, any>[]
  ): OperatorFunction<
    ResponseWithStatus<T, Error>,
    ResponseWithStatus<T, unknown>
  >;
};
