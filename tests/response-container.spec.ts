import {
  deserializeResponse,
  errorSymbol,
  inactiveSymbol,
  isError,
  isInactive,
  isLoading,
  isSuccess,
  loadingSymbol,
  metaSymbol,
  serializeResponse,
} from "../src/response-container";

describe("response-container symbols", () => {
  it("registers sentinels in the global Symbol registry", () => {
    expect(loadingSymbol).toBe(
      Symbol.for("@rx-evo/stateful-observable/loading"),
    );
    expect(errorSymbol).toBe(Symbol.for("@rx-evo/stateful-observable/error"));
    expect(inactiveSymbol).toBe(
      Symbol.for("@rx-evo/stateful-observable/inactive"),
    );
    expect(metaSymbol).toBe(Symbol.for("@rx-evo/stateful-observable/meta"));
  });
});

describe("serializeResponse / deserializeResponse", () => {
  it("roundtrips loading, inactive, error and value", () => {
    const loading = { state: loadingSymbol };
    const inactive = { state: inactiveSymbol };
    const error = { state: errorSymbol, error: "boom" };
    const value = { id: 1 };

    expect(serializeResponse(loading)).toEqual({ pending: true });
    expect(serializeResponse(inactive)).toEqual({ inactive: true });
    expect(serializeResponse(error)).toEqual({ error: "boom" });
    expect(serializeResponse(value)).toEqual({ value });

    expect(deserializeResponse(serializeResponse(loading))).toEqual(loading);
    expect(deserializeResponse(serializeResponse(inactive))).toEqual(inactive);
    expect(deserializeResponse(serializeResponse(error))).toEqual(error);
    expect(deserializeResponse(serializeResponse(value))).toEqual(value);
  });

  it("restores the same sentinel symbols after JSON.parse/stringify", () => {
    const jsonRoundtrip = <T>(response: T) =>
      deserializeResponse(JSON.parse(JSON.stringify(serializeResponse(response))));

    expect(jsonRoundtrip({ state: loadingSymbol })).toEqual({
      state: loadingSymbol,
    });
    expect(isLoading(jsonRoundtrip({ state: loadingSymbol }))).toBe(true);

    expect(jsonRoundtrip({ state: inactiveSymbol })).toEqual({
      state: inactiveSymbol,
    });
    expect(isInactive(jsonRoundtrip({ state: inactiveSymbol }))).toBe(true);

    expect(jsonRoundtrip({ state: errorSymbol, error: { code: 500 } })).toEqual({
      state: errorSymbol,
      error: { code: 500 },
    });
    expect(
      isError(jsonRoundtrip({ state: errorSymbol, error: { code: 500 } })),
    ).toBe(true);

    expect(jsonRoundtrip("ok")).toBe("ok");
    expect(isSuccess(jsonRoundtrip("ok"))).toBe(true);
  });

  it("treats user value { pending: true } as success, not loading", () => {
    const userValue = { pending: true as const };
    const dto = serializeResponse(userValue);

    expect(dto).toEqual({ value: { pending: true } });

    const restored = deserializeResponse(dto);
    expect(restored).toEqual({ pending: true });
    expect(isSuccess(restored)).toBe(true);
    expect(isLoading(restored)).toBe(false);
  });

  it("throws TypeError for an invalid DTO", () => {
    expect(() => deserializeResponse({} as never)).toThrow(TypeError);
  });
});
