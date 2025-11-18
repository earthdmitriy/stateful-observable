import {
  filter,
  map, Observable
} from "rxjs";

import { defaultCache, pipeError, pipeRaw, pipeValue } from "./operators";
import { isError, isLoading, isSuccess } from "./response-container";
import {
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
  ResponseWithStatus,
  StatefulObservable
} from "./types";

export const fillStatefulObservable = <Result, Error>(
  raw: Observable<ResponseWithStatus<Result, Error>>,
  reload: () => void,
): StatefulObservable<Result, Error> => {
  const cachedRaw$ = raw.pipe(defaultCache());

  return {
    raw$: cachedRaw$,

    reload,

    value$: cachedRaw$.pipe(filter(isSuccess)),
    error$: cachedRaw$.pipe(
      filter((e) => !isLoading(e)),
      map((e) => (isError(e) ? (e.error as Error) : false)),
    ),
    pending$: cachedRaw$.pipe(map(isLoading)),

    pipe: (...args: Parameters<PipeRawOperator>) =>
      fillStatefulObservable(cachedRaw$.pipe(pipeRaw(...args)), reload),

    pipeValue: (...args: Parameters<PipeValueOperator>) =>
      fillStatefulObservable(cachedRaw$.pipe(pipeValue(...args)), reload),

    pipeError: (...args: Parameters<PipeErrorOperator>) =>
      fillStatefulObservable(cachedRaw$.pipe(pipeError(...args)), reload),
  } as StatefulObservable<Result, Error>;
};