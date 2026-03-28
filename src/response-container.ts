import {
  ResponseError,
  ResponseInactive,
  ResponseLoading,
  ResponseWithStatus,
} from "./types";

export const loadingSymbol = Symbol("loading");
export const errorSymbol = Symbol("error");
export const inactiveSymbol = Symbol("inactive");

export const metaSymbol = Symbol("meta");

export const isLoading = <T>(
  response: ResponseWithStatus<T>,
): response is ResponseLoading =>
  (response as ResponseLoading)?.state === loadingSymbol;
export const isInactive = <T>(
  response: ResponseWithStatus<T>,
): response is ResponseInactive =>
  (response as ResponseInactive)?.state === inactiveSymbol;
export const isError = <T, E>(
  response: ResponseWithStatus<T, E>,
): response is ResponseError<E> =>
  (response as ResponseError)?.state === errorSymbol;

const statesSet = new Set([loadingSymbol, errorSymbol, inactiveSymbol]);

export const isSuccess = <T>(response: ResponseWithStatus<T>): response is T =>
  !(response as any).state || !statesSet.has((response as any).state);
