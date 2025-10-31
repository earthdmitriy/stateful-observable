import {
  BehaviorSubject,
  combineLatest,
  filter,
  map,
  merge,
  Observable,
  ObservableInput,
  ObservedValueOf,
  of,
  OperatorFunction,
  switchMap,
} from "rxjs";
import {
  catchResponseError,
  defaultCache,
  mapToLoading,
  pipeError,
  pipeRaw,
  pipeValue,
} from "./operators";
import { isError, isLoading, isSuccess } from "./response-container";
import {
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
  ResponseWithStatus,
  StatefulObservable,
} from "./types";

type TmapOperator = <T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O
) => OperatorFunction<T, ObservedValueOf<O>>;

export const fillStatefulObservable = <Result, Error>(
  raw: Observable<ResponseWithStatus<Result, Error>>,
  reload: () => void
): StatefulObservable<Result, Error> => {
  const cachedRaw$ = raw.pipe(defaultCache());

  return {
    raw$: cachedRaw$,

    reload,

    value$: cachedRaw$.pipe(filter(isSuccess)),
    error$: cachedRaw$.pipe(
      filter(isError),
      map((e) => e.error)
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

export const statefulObservable = <Input, Response = Input>(
  options:
    | {
        input: Observable<Input>;
        loader?: (input: Input) => ObservableInput<Response>;
        mapOperator?: TmapOperator;
      }
    | {
        input?: Observable<Input>;
        loader: (input: Input) => ObservableInput<Response>;
        mapOperator?: TmapOperator;
      }
): StatefulObservable<Response, unknown> => {
  const { input, loader, mapOperator = switchMap } = options;

  const source$ = (input?? of(true as Input));
  const reload$ = new BehaviorSubject(true);

  const inputWithReload$ = combineLatest([source$, reload$]).pipe(
    map(([input]) => input)
  );

  const loading$ = inputWithReload$.pipe(mapToLoading(), catchResponseError()); // source can throw errors too

  const valueOrError$ = inputWithReload$.pipe(
    mapOperator((input) =>
      loader ? loader(input) : of(input as unknown as Response)
    ),
    catchResponseError()
  );

  const raw = merge(loading$, valueOrError$);

  return fillStatefulObservable<Response, unknown>(raw, () =>
    reload$.next(true)
  );
};
