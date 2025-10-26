import { MonoTypeOperatorFunction, Observable, OperatorFunction } from "rxjs";
import { errorSymbol, loadingSymbol } from "./response-container";

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

export type StatefulObservableRaw<T = unknown, Error = unknown> = {
  raw: Observable<ResponseWithStatus<T, Error>>;
  reload: () => void;
};

export type StatefulObservableStreams<T = unknown, Error = unknown> = {
  value: Observable<T>;
  error: Observable<false | Error>;
  pending: Observable<boolean>;
};

export type StatefulObservableUtils<T = unknown, Error = unknown> = {
  pipe(): StatefulObservable<T, Error>;
  pipe(
    ...operations: MonoTypeOperatorFunction<ResponseWithStatus<T>>[]
  ): StatefulObservable<T>;

  pipeValue(): StatefulObservable<T, Error>;
  // omit error type because stream can fail with another error
  pipeValue<A>(op1: OperatorFunction<T, A>): StatefulObservable<A>;
  pipeValue<A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>
  ): StatefulObservable<B>;
  pipeValue<A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>
  ): StatefulObservable<C>;
  pipeValue<A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>
  ): StatefulObservable<D>;
  pipeValue<A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>
  ): StatefulObservable<E>;
  pipeValue<A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>
  ): StatefulObservable<F>;
  pipeValue<A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>
  ): StatefulObservable<G>;
  pipeValue<A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>
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
    op9: OperatorFunction<H, I>
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

  pipeError(): StatefulObservable<T, Error>;
  pipeError<A>(op1: OperatorFunction<T, A>): StatefulObservable<T, A>;
  pipeError<A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>
  ): StatefulObservable<T, B>;
  pipeError<A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>
  ): StatefulObservable<T, C>;
  pipeError<A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>
  ): StatefulObservable<T, D>;
  pipeError<A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>
  ): StatefulObservable<T, E>;
  pipeError<A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>
  ): StatefulObservable<T, F>;
  pipeError<A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>
  ): StatefulObservable<T, G>;
  pipeError<A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>
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
    op9: OperatorFunction<H, I>
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

export type StatefulObservable<
  T = unknown,
  Error = unknown,
> = StatefulObservableRaw<T, Error> &
  StatefulObservableStreams<T, Error> &
  StatefulObservableUtils<T, Error>;

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
    op1: OperatorFunction<T, A>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<A>>;
  <T, A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<B>>;
  <T, A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<C>>;
  <T, A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<D>>;
  <T, A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<E>>;
  <T, A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<F>>;
  <T, A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>
  ): OperatorFunction<ResponseWithStatus<T>, ResponseWithStatus<G>>;
  <T, A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>
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
    op9: OperatorFunction<H, I>
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
    op1: OperatorFunction<Error, A>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, A>>;
  <T, Error, A, B>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, B>>;
  <T, Error, A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, C>>;
  <T, Error, A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, D>>;
  <T, Error, A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, E>>;
  <T, Error, A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, F>>;
  <T, Error, A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>
  ): OperatorFunction<ResponseWithStatus<T, Error>, ResponseWithStatus<T, G>>;
  <T, Error, A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>
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
    op9: OperatorFunction<H, I>
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