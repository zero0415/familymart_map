import { describe, expect, it, vi } from "vitest";
import {
  CACHE_DURATION_MS,
  MapApiError,
  MapClient,
  MapProductImageClient,
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
    const [store] = parseMapResponse({ code: 1, data: [makeStore()] });
    expect(store.info[0].categories[0].products[0].code).toBe("0065108");
    expect(parseMapResponse({ code: 1, data: [] })).toEqual([]);
    expect(parseMapResponse({
      code: 1,
      data: [makeStore({ info: [{
        name: "友善食光",
        categories: [{ name: "食品", products: [{ name: "未附商品代碼", qty: 0 }] }],
      }] })],
    })[0].info[0].categories[0].products[0].code).toBeUndefined();
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
    expect(() => parseMapResponse({
      code: 1,
      data: [makeStore({ info: [{
        name: "美味挖寶",
        categories: [{ name: "食品", products: [{ name: "商品", code: "abc" }] }],
      }] })],
    })).toThrow(/回傳格式已變更/);
  });

  describe("MapProductImageClient", () => {
    const officialUrl = "https://delivery-prod-img.family.com.tw/product/0065108.png?v=202503191602";

    it("requests only the official endpoint on demand and accepts an official HTTPS image", async () => {
      const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ code: 1, data: { imageUrl: officialUrl } })),
      );
      const client = new MapProductImageClient(request);
      expect(request).not.toHaveBeenCalled();
      expect(await client.loadImage("0065108")).toBe(officialUrl);
      expect(request).toHaveBeenCalledTimes(1);
      const [url, options] = request.mock.calls[0];
      expect(url).toBe("https://stamp.family.com.tw/api/maps/MapProductImage?productId=0065108");
      expect(options).toMatchObject({
        method: "GET",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      await expect(client.loadImage("0065108&redirect=https://evil.example")).rejects
        .toThrow(/代碼格式無效/);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it.each([
      "javascript:alert(1)",
      "http://delivery-prod-img.family.com.tw/product/0065108.png",
      "https://delivery-prod-img.family.com.tw.evil.example/product/0065108.png",
      "https://user@delivery-prod-img.family.com.tw/product/0065108.png",
      "https://delivery-prod-img.family.com.tw:444/product/0065108.png",
    ])("refuses an unsafe image URL: %s", async (imageUrl) => {
      const client = new MapProductImageClient(async () =>
        new Response(JSON.stringify({ code: 1, data: { imageUrl } })),
      );
      await expect(client.loadImage("0065108")).rejects.toThrow(/圖片網址/);
    });

    it("reports missing images, API failures and invalid responses explicitly", async () => {
      const clientFor = (payload: unknown) => new MapProductImageClient(async () =>
        new Response(JSON.stringify(payload)),
      );
      await expect(clientFor({ code: 1, data: {} }).loadImage("0065108"))
        .rejects.toThrow(/未提供/);
      await expect(clientFor({ code: 1, data: { imageUrl: null } }).loadImage("0065108"))
        .rejects.toThrow(/未提供/);
      await expect(clientFor({ code: 0 }).loadImage("0065108"))
        .rejects.toThrow(/代碼 0/);
      await expect(clientFor({ code: 1, data: { imageUrl: 42 } }).loadImage("0065108"))
        .rejects.toThrow(/格式已變更/);
      await expect(new MapProductImageClient(async () => new Response("not-json"))
        .loadImage("0065108")).rejects.toThrow(/JSON/);
      await expect(new MapProductImageClient(async () => new Response("", { status: 503 }))
        .loadImage("0065108")).rejects.toThrow(/HTTP 503/);
      await expect(new MapProductImageClient(async () => { throw new TypeError("offline"); })
        .loadImage("0065108")).rejects.toThrow(/無法連線/);
    });
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

  it("queries a three-digit postal area with PostInfo, no coordinates or store keys, and a separate cache entry", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ code: 1, data: [makeStore()] }), { status: 200 }),
    );
    const client = new MapClient(request);

    await client.load(query);
    const postal = await client.load({
      source: "treasure",
      postalCode: "100",
      favoriteCodes: [],
    });
    expect(postal.stores).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toEqual({
      ProjectCode: "202208202",
      OldPKeys: [],
      PostInfo: "100",
      Latitude: 0,
      Longitude: 0,
    });
    expect((await client.load({
      source: "treasure",
      postalCode: "100",
      favoriteCodes: [],
    })).fromCache).toBe(true);
    await expect(client.load({
      source: "treasure",
      postalCode: "10a",
      favoriteCodes: [],
    })).rejects.toThrow(/郵遞區號須為 3 位數/);
    expect(request).toHaveBeenCalledTimes(2);
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
