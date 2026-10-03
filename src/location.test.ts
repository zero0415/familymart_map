import { describe, expect, it, vi } from "vitest";
import {
  AREA_PRESETS,
  parseCoordinates,
  requestLocation,
  TAIPEI_MRT_LINES,
  TAIPEI_MRT_STATIONS,
  type GeolocationClient,
} from "./location";

describe("Taipei MRT station presets", () => {
  it("groups Taipei stations by their first line and keeps verified interchange coordinates", () => {
    expect(TAIPEI_MRT_LINES.map((line) => line.label)).toEqual([
      "文湖線", "淡水信義線", "松山新店線", "中和新蘆線", "板南線",
    ]);
    expect(TAIPEI_MRT_STATIONS.find((station) => station.id === "mrt-r10")).toMatchObject({
      label: "台北車站（捷運站）",
      latitude: 25.04631,
      longitude: 121.517415,
    });
    expect(TAIPEI_MRT_STATIONS.find((station) => station.id === "mrt-bl18")).toMatchObject({
      label: "市政府（捷運站）",
      latitude: 25.041135,
      longitude: 121.565685,
    });
    expect(TAIPEI_MRT_STATIONS.filter((station) => station.label === "南港展覽館（捷運站）"))
      .toHaveLength(1);
    expect(AREA_PRESETS.some((area) => area.id === "taipei")).toBe(true);
    expect(AREA_PRESETS.some((area) => area.id === "banqiao")).toBe(true);
  });

  it("has no repeated stations or known non-Taipei stops, and coordinates stay within Taipei", () => {
    const ids = TAIPEI_MRT_STATIONS.map((station) => station.id);
    const names = TAIPEI_MRT_STATIONS.map((station) => station.label);
    const coordinates = TAIPEI_MRT_STATIONS.map(
      (station) => `${station.latitude},${station.longitude}`,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(coordinates).size).toBe(coordinates.length);
    for (const [line, prefix] of TAIPEI_MRT_LINES.map((group, index) =>
      [group, ["br", "r", "g", "o", "bl"][index]] as const
    )) {
      expect(line.stations.length).toBeGreaterThan(0);
      for (const station of line.stations) {
        expect(station.id).toMatch(new RegExp(`^mrt-${prefix}\\d`));
        expect(station.latitude).toBeGreaterThanOrEqual(24.98);
        expect(station.latitude).toBeLessThanOrEqual(25.15);
        expect(station.longitude).toBeGreaterThanOrEqual(121.46);
        expect(station.longitude).toBeLessThanOrEqual(121.63);
      }
    }
    for (const id of ["mrt-r26", "mrt-g04", "mrt-o13", "mrt-bl09", "mrt-bl23"]) {
      expect(ids).not.toContain(id);
    }
    for (const name of ["淡水", "大坪林", "頂溪", "板橋"]) {
      expect(names).not.toContain(`${name}（捷運站）`);
    }
  });
});

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
