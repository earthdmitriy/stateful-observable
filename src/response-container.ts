import { ResponseError, ResponseLoading, ResponseWithStatus } from "./types";

export const loadingSymbol = Symbol('loading');
export const errorSymbol = Symbol('error');
export const metaSymbol = Symbol('meta');


export const isLoading = <T>( 
  response: ResponseWithStatus<T>,
): response is ResponseLoading =>
  (response as ResponseLoading)?.state === loadingSymbol;
export const isError = <T,E>(
  response: ResponseWithStatus<T,E>,
): response is ResponseError<E> =>
  (response as ResponseError)?.state === errorSymbol;
export const isSuccess = <T>(response: ResponseWithStatus<T>): response is T =>
  !isLoading(response) && !isError(response);