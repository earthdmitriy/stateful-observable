import type {
  ResponseDto,
  ResponseError,
  ResponseInactive,
  ResponseLoading,
  ResponseWithStatus,
} from "./types";

export const loadingSymbol: unique symbol = Symbol.for(
  "@rx-evo/stateful-observable/loading",
);
export const errorSymbol: unique symbol = Symbol.for(
  "@rx-evo/stateful-observable/error",
);
export const inactiveSymbol: unique symbol = Symbol.for(
  "@rx-evo/stateful-observable/inactive",
);

export const metaSymbol: unique symbol = Symbol.for(
  "@rx-evo/stateful-observable/meta",
);

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

/**
 * Convert a {@link ResponseWithStatus} into a {@link ResponseDto}.
 *
 * {@link ResponseDto} is a serializable ResponseContainer: success is always
 * wrapped as `{ value }`, so user data cannot collide with pending / inactive
 * / error sentinels.
 */
export const serializeResponse = <T, E = unknown>(
  response: ResponseWithStatus<T, E>,
): ResponseDto<T, E> => {
  if (isInactive(response)) {
    return { inactive: true };
  }
  if (isLoading(response)) {
    return { pending: true };
  }
  if (isError(response)) {
    return { error: response.error };
  }
  return { value: response };
};

/**
 * Restore a {@link ResponseWithStatus} from a {@link ResponseDto}.
 *
 * {@link ResponseDto} is a serializable ResponseContainer. Invalid values that
 * do not match the DTO shape throw a TypeError.
 */
export const deserializeResponse = <T, E = unknown>(
  dto: ResponseDto<T, E>,
): ResponseWithStatus<T, E> => {
  if (dto === null || typeof dto !== "object") {
    throw new TypeError("Invalid ResponseDto");
  }
  if ("inactive" in dto) {
    return { state: inactiveSymbol };
  }
  if ("pending" in dto) {
    return { state: loadingSymbol };
  }
  if ("error" in dto) {
    return { state: errorSymbol, error: dto.error };
  }
  if ("value" in dto) {
    return dto.value;
  }
  throw new TypeError("Invalid ResponseDto");
};
