import { describe, expect, it, vi } from "vitest";
import {
  parseCoordinates,
  requestLocation,
  type GeolocationClient,
} from "./location";

describe("location and no-permission fallback", () => {
  it("validates manual coordinates instead of treating blank fields as zero", () => {
    expect(parseCoordinates(" 25.0479 ", "121.5171")).toEqual({
      latitude: 25.0479,
      longitude: 121.5171,
    });
    expect(() => parseCoordinates("", "121.5171")).toThrow(/請填寫/);
    expect(() => parseCoordinates("91", "121.5171")).toThrow(/座標無效/);
    expect(() => parseCoordinates("25", "not-a-number")).toThrow(/座標無效/);
  });

  it("requests the browser position only when called and applies a timeout", async () => {
    const getCurrentPosition = vi.fn(
      (success: PositionCallback, _error?: PositionErrorCallback, _options?: PositionOptions) => {
        success({
          coords: {
            latitude: 25.0479,
            longitude: 121.5171,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        });
      },
    );
    const geolocation: GeolocationClient = { getCurrentPosition };
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await expect(requestLocation(geolocation)).resolves.toEqual({
      latitude: 25.0479,
      longitude: 121.5171,
    });
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 300_000,
    });
  });

  it("returns actionable errors for denial, timeout, and missing geolocation", async () => {
    const makeError = (code: number): GeolocationPositionError => ({
      code,
      message: "",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
    const denied: GeolocationClient = {
      getCurrentPosition: (_success, error) => error?.(makeError(1)),
    };
    const timeout: GeolocationClient = {
      getCurrentPosition: (_success, error) => error?.(makeError(3)),
    };

    await expect(requestLocation(denied)).rejects.toThrow(/未取得定位權限/);
    await expect(requestLocation(timeout)).rejects.toThrow(/定位逾時/);
    await expect(requestLocation(undefined)).rejects.toThrow(/不支援定位/);
  });
});
