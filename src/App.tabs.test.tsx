import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { MapDataClient, MapQuery, MapResult } from "./api";
import { DirectoryError, type DirectoryDataClient, type DirectoryStore, type StoreDirectory } from "./directory";
import { FAVORITES_KEY } from "./favorites";
import { PRICE_NOTES_KEY } from "./price-notes";
import { makeStore } from "./test-fixtures";

const origin = { latitude: 25.0479, longitude: 121.5171 };
const north = (meters: number) => origin.latitude + meters * 180 / (Math.PI * 6_371_000);
const timestamp = new Date().toISOString();

const stores: DirectoryStore[] = [
  {
    code: "018687", name: "全家台鐵一店", address: "台北市中正區北平西路3號B1",
    latitude: 25.047203, longitude: 121.517044,
  },
  {
    code: "012345", name: "全家中山店", address: "臺北市中山區中山北路1號",
    latitude: north(1_500), longitude: origin.longitude,
  },
  {
    code: "012346", name: "全家公園店", address: "臺北市中山區公園路1號",
    latitude: north(2_900), longitude: origin.longitude,
  },
  {
    code: "012347", name: "全家超界店", address: "臺北市中山區超界路1號",
    latitude: north(3_100), longitude: origin.longitude,
  },
  {
    code: "025336", name: "全家龍潭大草坪店", address: "桃園市龍潭區佳安路5號",
    latitude: 24.834321, longitude: 121.240801,
  },
  {
    code: "000123", name: "全家座標異常店", address: "臺南市安定區蘇厝里293之68號",
    latitude: null, longitude: null,
  },
];

function directory(overrides: Partial<StoreDirectory> = {}): StoreDirectory {
  return { updatedAt: timestamp, unlocatedCount: 1, stores, ...overrides };
}

function mapClient(): MapDataClient {
  return {
    load: vi.fn(async ({ source, favoriteCodes }: MapQuery): Promise<MapResult> => ({
      stores: favoriteCodes.includes("012345")
        ? source === "treasure"
          ? [makeStore({
              oldPKey: "012345",
              name: "全家中山店",
              latitude: north(1_500) + 0.0005,
              longitude: origin.longitude,
              info: [{
                name: "美味挖寶",
                categories: [{ name: "食品", products: [{ name: "惜—中山點心", qty: 2, code: "0065108" }] }],
              }],
            })]
          : []
        : source === "treasure" ? [makeStore()] : [],
      fetchedAt: Date.now(),
      fromCache: false,
    })),
  };
}

let root: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", window.location.pathname);
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

function go(hash: string) {
  act(() => {
    window.history.pushState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function input(selector: string, value: string) {
  const field = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  act(() => {
    field.value = value;
    field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

function submit(selector: string) {
  act(() => {
    root.querySelector(selector)!.closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function nearbyRow(name: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>("#nearby .nearby-row")]
    .find((item) => item.querySelector("h3")?.textContent === name);
  if (!row) throw new Error(`Missing nearby store: ${name}`);
  return row;
}

function expand(row: HTMLElement) {
  const details = row.querySelector<HTMLDetailsElement>("details")!;
  act(() => {
    details.querySelector("summary")!.click();
    details.dispatchEvent(new Event("toggle"));
  });
  return details;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await act(async () => { await Promise.resolve(); });
}

describe("navigable store-finder pages and catalog-backed nearby stores", () => {
  it("follows hero links and browser back/forward history with a focused page heading", async () => {
    const client = mapClient();
    const directoryClient: DirectoryDataClient = { load: vi.fn(async () => directory()) };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));
    act(() => root.querySelector<HTMLAnchorElement>(".hero__actions a[href='#favorites']")!.click());
    await vi.waitFor(() => expect(root.querySelector("#favorites")?.hasAttribute("hidden")).toBe(false));
    expect(window.location.hash).toBe("#favorites");
    expect(document.activeElement?.id).toBe("favorites-title");

    act(() => root.querySelector<HTMLAnchorElement>("header nav a[href='#nearby']")!.click());
    await vi.waitFor(() => expect(root.querySelector("#nearby")?.hasAttribute("hidden")).toBe(false));
    expect(document.activeElement?.id).toBe("nearby-page-title");
    act(() => window.history.back());
    await vi.waitFor(() => expect(root.querySelector("#favorites")?.hasAttribute("hidden")).toBe(false));
    expect(window.location.hash).toBe("#favorites");
    expect(document.activeElement?.id).toBe("favorites-title");
    act(() => window.history.forward());
    await vi.waitFor(() => expect(root.querySelector("#nearby")?.hasAttribute("hidden")).toBe(false));
    expect(window.location.hash).toBe("#nearby");
    act(() => root.querySelector<HTMLAnchorElement>("header .brand")!.click());
    await vi.waitFor(() => expect(root.querySelector("#home")?.hasAttribute("hidden")).toBe(false));
    expect(document.activeElement?.id).toBe("home-title");
    expect(directoryClient.load).not.toHaveBeenCalled();
    expect(client.load).not.toHaveBeenCalled();
  });

  it("shows the five ordered pages and both hero CTAs, preserves forms/details, and handles hash back/focus", async () => {
    const client = mapClient();
    const directoryClient: DirectoryDataClient = { load: vi.fn(async () => directory()) };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));

    expect([...root.querySelectorAll("header nav a")].map((link) => link.textContent))
      .toEqual(["附近店家", "收藏店家", "收據參考", "原價紀錄", "資料說明"]);
    expect(root.querySelector("#home")?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector("#favorites")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector("#nearby")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelectorAll(".hero__actions a").length).toBe(2);
    expect(directoryClient.load).not.toHaveBeenCalled();
    expect(client.load).not.toHaveBeenCalled();

    go("#nearby");
    expect(root.querySelector("#home")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector("#nearby")?.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement?.id).toBe("nearby-page-title");
    expect(root.querySelector("header nav a[href='#nearby']")?.getAttribute("aria-current")).toBe("page");
    input("#latitude", "25.0614");
    input("#area", "taipei");
    submit("#area");
    await settle();
    const row = nearbyRow("全家台鐵西店");
    const details = expand(row);
    const calls = vi.mocked(client.load).mock.calls.length;
    expect(calls).toBe(2);

    go("#favorites");
    expect(root.querySelector("#favorites")?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector("#nearby")?.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement?.id).toBe("favorites-title");
    go("#receipt-prices");
    const receipt = root.querySelector<HTMLDetailsElement>("#receipt-prices details")!;
    act(() => receipt.querySelector("summary")!.click());
    expect(receipt.open).toBe(true);
    go("#price-notes");
    expect(document.activeElement?.id).toBe("price-notes-title");
    go("#about");
    expect(document.activeElement?.id).toBe("about-title");
    expect(root.querySelector("#about")?.textContent).toContain("隱私");
    go("#nearby");
    expect(root.querySelector<HTMLInputElement>("#latitude")?.value).toBe("25.0614");
    expect(details.open).toBe(true);
    expect(vi.mocked(client.load).mock.calls.length).toBe(calls);
    expect(directoryClient.load).toHaveBeenCalledTimes(1);
    go("#receipt-prices");
    expect(receipt.open).toBe(true);

    window.history.replaceState(null, "", "#favorites");
    act(() => render(null, root));
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));
    expect(root.querySelector("#favorites")?.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement?.id).toBe("favorites-title");
  });

  it("lists the full 3 km directory plus map-only shops, in distance order, without eager products", async () => {
    const client = mapClient();
    const directoryClient: DirectoryDataClient = { load: vi.fn(async () => directory()) };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));
    go("#nearby");
    input("#area", "taipei");
    submit("#area");
    await settle();

    const rows = [...root.querySelectorAll<HTMLElement>("#nearby .nearby-row")];
    expect(rows.map((row) => row.querySelector("h3")?.textContent))
      .toEqual(["全家台鐵西店", "全家台鐵一店", "全家中山店", "全家公園店"]);
    expect(nearbyRow("全家中山店").textContent).toContain("1.50 km");
    expect(nearbyRow("全家公園店").textContent).toContain("2.90 km");
    expect(root.querySelector("#nearby")?.textContent).not.toContain("全家超界店");
    expect(root.querySelector("#nearby")?.textContent).not.toContain("全家龍潭大草坪店");
    expect(root.querySelector("#nearby")?.textContent).toContain("3 公里內 4 間店");
    expect(root.querySelector("#nearby")?.textContent).toContain("1 間座標異常");
    expect(root.querySelectorAll("#nearby .product-list li")).toHaveLength(0);
    expect(client.load).toHaveBeenCalledTimes(2);
    expect(directoryClient.load).toHaveBeenCalledTimes(1);

    const distant = nearbyRow("全家中山店");
    const details = expand(distant);
    expect(details.open).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      source: "treasure",
      favoriteCodes: ["012345"],
    }));
    expect(distant.textContent).toContain("惜—中山點心");
    expect(distant.textContent).toContain("未回傳此店商品資料，不代表缺貨");
    expect(distant.querySelector(".product-list__receipt-price")?.textContent).toContain("收據原價");
    expect(distant.querySelector(".product-list__image-button")).not.toBeNull();
    input("#price-input-nearby-012345-treasure-0-0065108", "49.50");
    submit("#price-input-nearby-012345-treasure-0-0065108");
    expect(JSON.parse(window.localStorage.getItem(PRICE_NOTES_KEY)!)[0].priceCents).toBe(4_950);
    const add = distant.querySelector<HTMLButtonElement>("button[aria-label^='加入收藏']")!;
    act(() => add.click());
    expect(distant.querySelector(".favorite-button--active")?.textContent).toContain("已收藏");
    expect(distant.querySelector("button[aria-label^='移除']")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual([
      expect.objectContaining({ code: "012345", name: "全家中山店" }),
    ]);
    expect(root.querySelector("#favorites .store-card")?.textContent).toContain("惜—中山點心");
    expect(details.open).toBe(true);
  });

  it("keeps a map-only station shop once when a directory name points to a different code", async () => {
    const duplicate: DirectoryStore = {
      code: "011111", name: "全家台鐵西店", address: "台北市中正區北平西路3號",
      latitude: 25.047203, longitude: 121.517044,
    };
    const directoryClient: DirectoryDataClient = {
      load: vi.fn(async () => directory({ stores: [...stores, duplicate] })),
    };
    act(() => render(<App client={mapClient()} directoryClient={directoryClient} geolocation={null} />, root));
    go("#nearby");
    input("#area", "taipei");
    submit("#area");
    await settle();

    const matches = [...root.querySelectorAll<HTMLElement>("#nearby .nearby-row")]
      .filter((row) => row.querySelector("h3")?.textContent === "全家台鐵西店");
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toContain("店代碼 018558");
    act(() => matches[0].querySelector<HTMLButtonElement>("button[aria-label^='加入收藏']")!.click());
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)[0].code).toBe("018558");
    expect(root.querySelector("#nearby .result-count")?.textContent).toContain("3 公里內 4 間店");
  });

  it("never applies same-name wrong-code or wrong-location products to a catalog favorite", async () => {
    const directoryClient: DirectoryDataClient = { load: vi.fn(async () => directory()) };
    const wrongCode = makeStore({
      oldPKey: "023510",
      name: "全家台鐵一店",
      latitude: 25.047203,
      info: [{
        name: "美味挖寶",
        categories: [{ name: "食品", products: [{ name: "錯店商品", qty: 9 }] }],
      }],
    });
    const wrongLocation = makeStore({
      oldPKey: "018687",
      name: "全家台鐵一店",
      latitude: 25.0505,
      info: wrongCode.info,
    });
    const client: MapDataClient = {
      load: vi.fn(async ({ source, favoriteCodes }: MapQuery): Promise<MapResult> => ({
        stores: favoriteCodes.includes("018687") && source === "treasure"
          ? [wrongCode, wrongLocation]
          : [],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));
    go("#favorites");
    input("#store-search", "台鐵一");
    submit("#store-search");
    await act(async () => { await Promise.resolve(); });
    act(() => root.querySelector<HTMLButtonElement>(".search-preview li button")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({ favoriteCodes: ["018687"] }));
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)[0].code).toBe("018687");
    expect(root.querySelector("#favorites")?.textContent).toContain("全家台鐵一店");
    expect(root.querySelector("#favorites")?.textContent).not.toContain("錯店商品");
    expect(root.querySelector("#favorites .source-badge--treasure")?.textContent).toContain("讀取失敗");
    expect(root.querySelector("#favorites .store-card__details")?.textContent)
      .toContain("店代碼、店名或座標");
  });

  it("replaces a catalog favorite's lazy product data on manual refresh without stale overrides", async () => {
    const directoryClient: DirectoryDataClient = { load: vi.fn(async () => directory()) };
    const client: MapDataClient = {
      load: vi.fn(async ({ source, favoriteCodes, force }: MapQuery): Promise<MapResult> => ({
        stores: source !== "treasure"
          ? []
          : favoriteCodes.includes("012345")
            ? [makeStore({
                oldPKey: "012345",
                name: "全家中山店",
                latitude: north(1_500),
                longitude: origin.longitude,
                info: [{
                  name: "美味挖寶",
                  categories: [{
                    name: "食品",
                    products: [{ name: force ? "刷新後點心" : "原本點心", qty: 1 }],
                  }],
                }],
              })]
            : [makeStore()],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));
    go("#nearby");
    input("#area", "taipei");
    submit("#area");
    await settle();
    act(() => nearbyRow("全家中山店").querySelector<HTMLButtonElement>("button[aria-label^='加入收藏']")!.click());
    await act(async () => { await Promise.resolve(); });
    go("#favorites");
    expect(root.querySelector("#favorites")?.textContent).toContain("原本點心");
    go("#nearby");
    act(() => root.querySelector<HTMLButtonElement>("#nearby .refresh-button")!.click());
    await settle();
    go("#favorites");
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      source: "treasure", favoriteCodes: ["012345"], force: true,
    }));
    expect(root.querySelector("#favorites")?.textContent).toContain("刷新後點心");
    expect(root.querySelector("#favorites")?.textContent).not.toContain("原本點心");
  });

  it("does not invent a 3 km list when the snapshot fails, and offers retry alongside location fallbacks", async () => {
    const client: MapDataClient = {
      load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => ({
        stores: source === "treasure" ? [makeStore()] : [],
        fetchedAt: Date.now(),
        fromCache: false,
      })),
    };
    const load = vi.fn()
      .mockRejectedValueOnce(new DirectoryError("network", "快照暫時無法載入"))
      .mockResolvedValue(directory());
    const directoryClient: DirectoryDataClient = { load };
    const denied = {
      code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
    } satisfies GeolocationPositionError;
    const geolocation = {
      getCurrentPosition: vi.fn((_success: PositionCallback, error?: PositionErrorCallback | null) =>
        error?.(denied)),
    };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={geolocation} />, root));
    go("#nearby");
    await act(async () => {
      root.querySelector<HTMLButtonElement>(".primary-button")!.click();
      await Promise.resolve();
    });
    expect(root.querySelector("#location [role='alert']")?.textContent).toContain("未取得定位權限");
    expect(document.activeElement?.id).toBe("area");
    input("#area", "taipei");
    submit("#area");
    await settle();
    expect(root.querySelector(".directory-error")?.textContent).toContain("快照暫時無法載入");
    expect(root.querySelector("#nearby .result-count")?.textContent).toContain("非 3 公里完整名單");
    act(() => root.querySelector<HTMLButtonElement>(".directory-error button")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(root.querySelector(".directory-error")).toBeNull();
    expect(root.querySelector("#nearby .result-count")?.textContent).toContain("3 公里內 4 間店");
    input("#latitude", "25.0479");
    input("#longitude", "121.5171");
    submit("#longitude");
    await settle();
    expect(root.querySelector("#nearby")?.textContent).toContain("全家公園店");
    input("#postal-code", "100");
    submit("#postal-code");
    await settle();
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({
      postalCode: "100", favoriteCodes: [],
    }));
    expect(root.querySelector("#nearby .result-count")?.textContent).toContain("非完整名錄");
  });

  it("keeps catalog name search independent of nearby and existing saved-store cards", async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([{
      code: "018558", name: "全家台鐵西店", address: "台北市中正區北平西路３號",
    }]));
    const client = mapClient();
    const directoryClient: DirectoryDataClient = { load: vi.fn(async () => directory()) };
    act(() => render(<App client={client} directoryClient={directoryClient} geolocation={null} />, root));
    go("#favorites");
    input("#store-search", "龍潭大草坪");
    submit("#store-search");
    await act(async () => { await Promise.resolve(); });
    expect(root.querySelector(".search-preview")?.textContent).toContain("全家龍潭大草坪店");
    expect(root.querySelector("#favorites")?.textContent).toContain("全家台鐵西店");
    act(() => root.querySelector<HTMLButtonElement>(".search-preview li button")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(root.querySelectorAll("#favorites .store-card")).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual([
      expect.objectContaining({ code: "025336" }),
      expect.objectContaining({ code: "018558" }),
    ]);
    expect(root.querySelector(".search-preview__saved")?.textContent).toBe("已收藏");
    go("#nearby");
    expect(directoryClient.load).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#nearby .nearby-row")).toBeNull();
    expect(root.querySelector("#favorites")?.textContent).toContain("全家台鐵西店");
  });
});
