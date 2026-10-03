import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { MapApiError, type MapDataClient, type MapQuery, type MapResult } from "./api";
import { FAVORITES_KEY } from "./favorites";
import type { GeolocationClient } from "./location";
import { makeStore } from "./test-fixtures";

let root: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

function fixtureClient(): MapDataClient {
  return {
    load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => ({
      stores: source === "treasure" ? [makeStore()] : [],
      fetchedAt: Date.parse("2026-10-04T03:50:00+08:00"),
      fromCache: false,
    })),
  };
}

function button(label: RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
    label.test(element.getAttribute("aria-label") ?? element.textContent ?? ""),
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

async function settleQueries() {
  await new Promise((resolve) => setTimeout(resolve, 450));
  await act(async () => {
    await Promise.resolve();
  });
}

function setInput(selector: string, value: string) {
  const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!input) throw new Error(`Input not found: ${selector}`);
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

function submit(inputSelector: string) {
  const form = root.querySelector(inputSelector)?.closest("form");
  if (!form) throw new Error(`Form not found for: ${inputSelector}`);
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("interactive store finder", () => {
  it("never requests location automatically; denial exposes a working region fallback and persistent favorite", async () => {
    const client = fixtureClient();
    const denied: GeolocationPositionError = {
      code: 1,
      message: "denied",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error?: PositionErrorCallback | null) => error?.(denied),
    );
    const geolocation: GeolocationClient = { getCurrentPosition };
    act(() => render(<App client={client} geolocation={geolocation} />, root));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(client.load).not.toHaveBeenCalled();

    await act(async () => {
      button(/使用目前位置/).click();
      await Promise.resolve();
    });
    expect(root.textContent).toContain("未取得定位權限");
    expect(document.activeElement).toBe(root.querySelector("#area"));

    setInput("#area", "taipei");
    submit("#area");
    await settleQueries();

    expect(client.load).toHaveBeenCalledTimes(2);
    expect(client.load).toHaveBeenCalledWith(
      expect.objectContaining({
        position: { latitude: 25.0479, longitude: 121.5171 },
      }),
    );
    expect(root.querySelector("#nearby")?.textContent).toContain("全家台鐵西店");
    expect(root.querySelector("#nearby")?.textContent).toContain("惜—北海道玉米濃湯洋芋片");
    const details = root.querySelector<HTMLDetailsElement>("#nearby .store-card details")!;
    details.open = true;
    act(() => button(/加入收藏：全家台鐵西店/).click());
    await settleQueries();
    expect(client.load).toHaveBeenCalledTimes(2);
    expect(root.querySelector<HTMLDetailsElement>("#nearby .store-card details")?.open).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual([
      expect.objectContaining({ code: "018558", name: "全家台鐵西店" }),
    ]);
  });

  it("accepts an unknown code without location and keeps it if official maps return nothing", async () => {
    const client: MapDataClient = {
      load: vi.fn(async (): Promise<MapResult> => ({
        stores: [],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    act(() => render(<App client={client} geolocation={null} />, root));
    setInput("#store-code", "unknown");
    submit("#store-code");
    expect(root.textContent).toContain("請輸入官方地圖或收據上的數字店代碼");
    expect(client.load).not.toHaveBeenCalled();

    setInput("#store-code", "018558");
    submit("#store-code");
    await settleQueries();

    expect(client.load).toHaveBeenCalledTimes(2);
    expect(root.querySelector("#favorites")?.textContent).toContain("店代碼 018558");
    expect(root.querySelector("#favorites")?.textContent).toContain("未回傳此店商品資料");
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual([
      expect.objectContaining({ code: "018558" }),
    ]);
  });

  it("keeps a saved favorite when both maps return no store or product data", async () => {
    window.localStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify([{ code: "018558", name: "全家台鐵西店" }]),
    );
    const client: MapDataClient = {
      load: vi.fn(async (): Promise<MapResult> => ({
        stores: [],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    act(() => render(<App client={client} geolocation={null} />, root));
    await settleQueries();

    expect(client.load).toHaveBeenCalledTimes(2);
    expect(client.load).toHaveBeenCalledWith(
      expect.objectContaining({
        favoriteCodes: ["018558"],
        position: { latitude: 25.0479, longitude: 121.5171 },
      }),
    );
    expect(root.querySelector("#favorites")?.textContent).toContain("全家台鐵西店");
    expect(root.querySelector("#favorites")?.textContent).toContain("未回傳此店商品資料");
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toHaveLength(1);
  });

  it("explains why name-only search needs an area, then searches postal map data and saves a match", async () => {
    const client = fixtureClient();
    act(() => render(<App client={client} geolocation={null} />, root));

    setInput("#store-search", "台鐵西");
    submit("#store-search");
    expect(root.textContent).toContain("請先選擇附近位置，或填三位數郵遞區號");
    expect(document.activeElement).toBe(root.querySelector("#postal-code"));
    expect(client.load).not.toHaveBeenCalled();

    setInput("#postal-code", "100");
    submit("#store-search");
    await settleQueries();

    expect(client.load).toHaveBeenCalledTimes(2);
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      source: "treasure",
      postalCode: "100",
      favoriteCodes: [],
    }));
    expect(root.querySelector("#nearby-title")?.textContent).toContain("分店搜尋結果");
    expect(root.querySelector("#nearby .store-card")?.textContent).toContain("全家台鐵西店");
    expect(root.querySelector(".search-preview")?.textContent).toContain("已載入清單符合 1 間分店");

    const preview = root.querySelector<HTMLButtonElement>(".search-preview li button")!;
    act(() => preview.click());
    await settleQueries();

    expect(client.load).toHaveBeenCalledTimes(4);
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      position: { latitude: 25.0479, longitude: 121.5171 },
      favoriteCodes: ["018558"],
    }));
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      source: "treasure",
      postalCode: "100",
      favoriteCodes: [],
    }));
    expect(root.querySelector("#favorites .store-card")?.textContent).toContain("惜—北海道玉米濃湯洋芋片");
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual([
      expect.objectContaining({ code: "018558" }),
    ]);
  });

  it("submits a name search within a loaded area and presents matching stores next to the field", async () => {
    const client = fixtureClient();
    act(() => render(<App client={client} geolocation={null} />, root));
    setInput("#area", "taipei");
    submit("#area");
    await settleQueries();

    setInput("#store-search", "台鐵西");
    submit("#store-search");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(root.querySelector(".search-preview")?.textContent).toContain("全家台鐵西店");
    expect(root.querySelector(".name-search [role='status']")?.textContent)
      .toContain("已載入清單符合 1 間店");
    expect(document.activeElement).toBe(root.querySelector("#nearby-title"));
    expect(client.load).toHaveBeenCalledTimes(2);
  });

  it("keeps an out-of-area favorite separate from postal search results", async () => {
    window.localStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify([{ code: "999999", name: "全家舊收藏" }]),
    );
    const client: MapDataClient = {
      load: vi.fn(async ({ source, favoriteCodes }: MapQuery): Promise<MapResult> => ({
        stores: source !== "treasure"
          ? []
          : favoriteCodes.length > 0
            ? [makeStore({ oldPKey: "999999", name: "全家舊收藏", address: "高雄市三民區", latitude: 22.63 })]
            : [makeStore()],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    act(() => render(<App client={client} geolocation={null} />, root));
    setInput("#postal-code", "100");
    submit("#store-search");
    await settleQueries();

    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      postalCode: "100",
      favoriteCodes: [],
    }));
    expect(root.querySelector("#nearby")?.textContent).toContain("全家台鐵西店");
    expect(root.querySelector("#nearby")?.textContent).not.toContain("全家舊收藏");
    expect(root.querySelector("#favorites")?.textContent).toContain("全家舊收藏");
    expect(root.querySelector("#favorites")?.textContent).toContain("惜—北海道玉米濃湯洋芋片");
  });

  it("validates postal input and distinguishes empty results from API failures", async () => {
    const client: MapDataClient = {
      load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => {
        if (source === "food") throw new MapApiError("network", "友善食光暫時讀取失敗");
        return { stores: [], fetchedAt: Date.now(), fromCache: false };
      }),
    };
    act(() => render(<App client={client} geolocation={null} />, root));
    setInput("#store-search", "台鐵西");
    setInput("#postal-code", "10a");
    submit("#store-search");
    expect(root.textContent).toContain("請輸入三位數郵遞區號");
    expect(client.load).not.toHaveBeenCalled();

    setInput("#postal-code", "100");
    submit("#store-search");
    await settleQueries();

    expect(root.querySelector(".source-status--food [role='alert']")?.textContent)
      .toContain("友善食光暫時讀取失敗");
    expect(root.querySelector(".search-preview")?.textContent)
      .toContain("部分地圖讀取失敗，搜尋結果不完整");
    expect(root.querySelector("#nearby")?.textContent)
      .toContain("部分地圖資料暫時無法確認");
    expect(root.querySelector("#nearby")?.textContent).not.toContain("缺貨");
  });

  it("does not interpret an empty postal map response as a missing store or confirmed stock level", async () => {
    const client: MapDataClient = {
      load: vi.fn(async (): Promise<MapResult> => ({
        stores: [],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    act(() => render(<App client={client} geolocation={null} />, root));
    setInput("#store-search", "台鐵西");
    setInput("#postal-code", "100");
    submit("#store-search");
    await settleQueries();

    expect(root.querySelector(".search-preview")?.textContent)
      .toContain("目前地圖未回傳符合店名的店家");
    expect(root.querySelector("#nearby")?.textContent).toContain("不代表店家缺貨");
    expect(root.querySelector("#favorites")?.textContent).toContain("還沒有收藏的分店");
  });

  it("shows partial API errors without hiding successful map products", async () => {
    const client: MapDataClient = {
      load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => {
        if (source === "food") throw new MapApiError("network", "友善食光讀取失敗");
        return { stores: [makeStore()], fetchedAt: Date.now(), fromCache: false };
      }),
    };
    act(() => render(<App client={client} geolocation={null} />, root));

    setInput("#latitude", "25.0479");
    setInput("#longitude", "121.5171");
    submit("#longitude");
    await settleQueries();

    expect(root.querySelector("#nearby")?.textContent).toContain("全家台鐵西店");
    expect(root.querySelector("#nearby")?.textContent).toContain("部分地圖讀取失敗");
    expect(root.querySelector(".source-status--food [role='alert']")?.textContent)
      .toContain("友善食光讀取失敗");
    expect(root.querySelector("#nearby")?.textContent).toContain("惜—北海道玉米濃湯洋芋片");

    act(() => button(/重新查詢/).click());
    await settleQueries();
    expect(client.load).toHaveBeenCalledTimes(4);
    act(() => button(/重新查詢/).click());
    expect(client.load).toHaveBeenCalledTimes(4);
    expect(root.textContent).toContain("至少間隔 1 分鐘");
  });

  it("does not claim a missing name match when both map requests fail", async () => {
    const client: MapDataClient = {
      load: vi.fn(async () => {
        throw new MapApiError("service", "官方地圖服務暫時失敗");
      }),
    };
    act(() => render(<App client={client} geolocation={null} />, root));
    setInput("#area", "taipei");
    submit("#area");
    setInput("#store-search", "台鐵西");
    await settleQueries();

    expect(root.querySelector("#nearby")?.textContent).toContain("部分地圖資料暫時無法確認");
    expect(root.querySelector("#nearby")?.textContent).toContain("兩張地圖都無法讀取");
    expect(root.querySelector("#nearby")?.textContent).not.toContain("附近沒有符合搜尋的店");
  });
});
