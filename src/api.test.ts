import { describe, expect, it, vi } from "vitest";
import {
  CACHE_DURATION_MS,
  MapApiError,
  MapClient,
  parseMapResponse,
  type MapQuery,
} from "./api";
import { makeStore } from "./test-fixtures";

const query: MapQuery = {
  source: "treasure",
  position: { latitude: 25.04791234, longitude: 121.51713456 },
  favoriteCodes: ["018558"],
};

describe("official map response", () => {
  it("accepts a valid store and an empty response without inventing products", () => {
    expect(parseMapResponse({ code: 1, data: [makeStore()] })).toHaveLength(1);
    expect(parseMapResponse({ code: 1, data: [] })).toEqual([]);
  });

  it("reports service errors and changed or ambiguous response formats", () => {
    expect(() => parseMapResponse({ code: 0, data: [] })).toThrow(/代碼 0/);
    expect(() => parseMapResponse({ code: 1, data: null })).toThrow(MapApiError);
    expect(() => parseMapResponse({ code: 1, data: [makeStore(), makeStore()] }))
      .toThrow(/重複的店代碼/);
    expect(() =>
      parseMapResponse({
        code: 1,
        data: [{
          ...makeStore(),
          info: [{
            name: "挖寶",
            categories: [{ name: "食品", products: [{ name: "商品", qty: "2" }] }],
          }],
        }],
      }),
    ).toThrow(/回傳格式已變更/);
  });
});

describe("MapClient", () => {
  it("uses only the credentialless official endpoint, rounds location, and caches for five minutes", async () => {
    let now = 1_780_000_000_000;
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ code: 1, data: [makeStore()] }), { status: 200 }),
    );
    const client = new MapClient(request, () => now);

    const fresh = await client.load(query);
    expect(fresh.fromCache).toBe(false);
    expect(fresh.stores[0].oldPKey).toBe("018558");
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://stamp.family.com.tw/api/maps/MapProductInfo");
    expect(options).toMatchObject({
      method: "POST",
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(options!.body as string)).toEqual({
      ProjectCode: "202208202",
      OldPKeys: ["018558"],
      PostInfo: "",
      Latitude: 25.0479,
      Longitude: 121.5171,
    });

    now += CACHE_DURATION_MS - 1;
    expect((await client.load(query)).fromCache).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);

    now += 2;
    await client.load(query);
    expect(request).toHaveBeenCalledTimes(2);
    await client.load({ ...query, force: true });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("surfaces HTTP, invalid JSON, and network failures distinctly", async () => {
    const httpClient = new MapClient(async () => new Response("", { status: 503 }));
    await expect(httpClient.load(query)).rejects.toThrow(/HTTP 503/);

    const invalidClient = new MapClient(async () => new Response("not-json"));
    await expect(invalidClient.load(query)).rejects.toThrow(/JSON/);

    const offlineClient = new MapClient(async () => {
      throw new TypeError("offline");
    });
    await expect(offlineClient.load(query)).rejects.toThrow(/無法連線/);
  });
});
