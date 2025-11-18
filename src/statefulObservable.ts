import {
  BehaviorSubject,
  combineLatest, from,
  map,
  merge,
  mergeMap,
  Observable,
  ObservableInput,
  ObservedValueOf,
  of,
  OperatorFunction,
  tap
} from 'rxjs';
import { fillStatefulObservable } from './chaining';
import {
  catchResponseError, mapToLoading
} from './operators';
import {
  StatefulObservable
} from './types';

type TmapOperator = <T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O,
) => OperatorFunction<T, ObservedValueOf<O>>;



export const statefulObservable = <Input, Response = Input>(
  options:
    | {
        input: Observable<Input>;
        cacheKey?: (i: Input) => any[];
        loader?: (input: Input) => ObservableInput<Response>;
        mapOperator?: TmapOperator;
      }
    | {
        input?: Observable<Input>;
        cacheKey?: (i: Input) => any[];
        loader: (input: Input) => ObservableInput<Response>;
        mapOperator?: TmapOperator;
      },
): StatefulObservable<Response, unknown> => { 
  const {
    input,
    loader,
    mapOperator = mergeMap,
    cacheKey = () => [], // falsy cache key will skip caching
  } = options;

  const source$ = input ?? of(true as Input);
  const cache$ = new BehaviorSubject({} as { [key: string]: Response });

  const loading$ = combineLatest([source$, cache$]).pipe(
    mapToLoading(),
    catchResponseError(),
  ); // source can throw errors too

  const makeObservableInput = (input: Input) =>
    loader ? loader(input) : of(input as unknown as Response);

  const valueOrError$ = combineLatest([source$, cache$]).pipe(
    map(([input, cacheMap]) => ({
      input,
      cacheMap,
      key: cacheKey(input).join('|'),
    })),
    mapOperator(({ input, cacheMap, key }) => {
      if (key) {// skip if no cache key
        const cache = cacheMap[key];
        if (cache) return of(cache);
      }

      return from(makeObservableInput(input)).pipe(
        tap({
          next: (result) => (cacheMap[key] = result),
        }),
        catchResponseError(),
      );
    }),
    catchResponseError(),
  );

  const raw = merge(loading$, valueOrError$);

  return fillStatefulObservable<Response, unknown>(raw, () => cache$.next({}));
};
