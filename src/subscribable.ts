import { Observable } from 'rxjs';
import { isError, isLoading, isSuccess } from './response-container';
import { ObserverWithPending, ResponseWithStatus } from './types';

export const makeSubscribe =
  <Result>(observable: Observable<ResponseWithStatus<Result>>) =>
  (
    observerOrNext?:
      | Partial<ObserverWithPending<Result>>
      | ((value: Result) => void),
  ) => {
    if (!observerOrNext) return observable.subscribe;

    if (typeof observerOrNext === 'function') {
      const subscription = observable.subscribe({
        next: (rawValue) => {
          if (isSuccess(rawValue)) {
            observerOrNext(rawValue);
          }
        },
      });
      return {
        unsubscribe: () => subscription.unsubscribe(),
      };
    }

    const subscription = observable.subscribe({
      next: (rawValue) => {
        if (isLoading(rawValue)) observerOrNext.pending?.(true);
        if (isSuccess(rawValue)) {
          observerOrNext.next?.(rawValue);
          observerOrNext.pending?.(false);
        }
        if (isError(rawValue)) {
          observerOrNext.error?.(rawValue.error);
          observerOrNext.pending?.(false);
        }
      },
      error: (err) => {
        observerOrNext.error?.(err);
      },
      complete: () => {
        observerOrNext.complete?.();
      },
    });
    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  };
