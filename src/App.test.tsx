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

function renderDeniedLocationApp() {
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
  return { client, getCurrentPosition };
}

function productFixtureClient(): MapDataClient {
  const treasure = makeStore({
    info: [
      {
        name: "美味挖寶",
        categories: [{
          name: "食品",
          products: [
            { name: "惜—食品甲", qty: 1, code: "0065108" },
            { name: "一般食品乙", qty: 2 },
          ],
        }],
      },
      {
        name: "生活好物",
        categories: [{
          name: "用品",
          products: [
            { name: "惜-清潔用品", qty: 3, code: "0459602" },
            { name: "一般用品", qty: 4 },
          ],
        }],
      },
      {
        name: "珍藏酒窖",
        categories: [{
          name: "禁止酒駕／未滿十八歲禁止飲酒",
          products: [{ name: "惜—酒品", qty: 1 }, { name: "一般酒品", qty: 2 }],
        }],
      },
      {
        name: "新群組",
        categories: [{ name: "食品", products: [{ name: "惜—神秘包", qty: 1 }] }],
      },
    ],
  });
  const food = makeStore({
    info: [{
      name: "友善食光",
      categories: [{
        name: "鮮食",
        products: [
          { name: "友善便當", qty: 0, code: "0789123" },
          { name: "友善無圖飯糰", qty: null },
        ],
      }],
    }],
  });
  return {
    load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => ({
      stores: [source === "treasure" ? treasure : food],
      fetchedAt: Date.parse("2026-10-04T03:50:00+08:00"),
      fromCache: false,
    })),
  };
}

function saveFixtureFavorite() {
  window.localStorage.setItem(
    FAVORITES_KEY,
    JSON.stringify([{ code: "018558", name: "全家台鐵西店" }]),
  );
}

function button(label: RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
    label.test(element.getAttribute("aria-label") ?? element.textContent ?? ""),
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function favoriteCard(name: string): HTMLElement {
  const card = [...root.querySelectorAll<HTMLElement>("#favorites .store-card")].find(
    (element) => element.querySelector("h3")?.textContent === name,
  );
  if (!card) throw new Error(`Favorite card not found: ${name}`);
  return card;
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
  it("never requests location automatically and reports denied permission", async () => {
    const { client, getCurrentPosition } = renderDeniedLocationApp();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(client.load).not.toHaveBeenCalled();

    await act(async () => {
      button(/使用目前位置/).click();
      await Promise.resolve();
    });
    expect(root.textContent).toContain("未取得定位權限");
    expect(document.activeElement).toBe(root.querySelector("#area"));
  });

  describe("favorite treasure filters", () => {
    it("filters only treasure products in saved stores, without hiding stores, food or nearby products", async () => {
      saveFixtureFavorite();
      const client = productFixtureClient();
      act(() => render(<App client={client} geolocation={null} />, root));
      setInput("#area", "taipei");
      submit("#area");
      await settleQueries();
      expect(client.load).toHaveBeenCalledTimes(2);

      const saved = favoriteCard("全家台鐵西店");
      const savedDetails = saved.querySelector<HTMLDetailsElement>("details")!;
      const nearbyDetails = root.querySelector<HTMLDetailsElement>("#nearby .store-card details")!;
      expect(savedDetails.open).toBe(false);
      expect(nearbyDetails.open).toBe(false);
      act(() => savedDetails.querySelector("summary")!.click());
      expect(savedDetails.open).toBe(true);
      expect(saved.querySelectorAll(".product-panel--treasure .product-list li")).toHaveLength(7);
      expect(saved.querySelector(".product-panel--treasure")?.textContent).toContain("類別／折扣未知");
      expect(saved.querySelector(".product-panel--treasure")?.textContent).toContain("折扣未知");
      expect(saved.querySelector(".product-panel--treasure")?.textContent).toContain("3折");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("友善便當");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("0 件");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("資料時間");
      expect(saved.querySelector(".product-panel--food")?.textContent).not.toMatch(/5折|3折|折扣未知/);
      expect(root.querySelector("#favorites")?.textContent).toContain("實際優惠以官方／現場為準");

      setInput("#favorite-category", "supplies");
      setInput("#favorite-prefix", "saving");
      setInput("#favorite-discount", "3折");
      expect(saved.querySelectorAll(".product-panel--treasure .product-list li")).toHaveLength(1);
      expect(saved.querySelector(".product-panel--treasure .product-list")?.textContent)
        .toContain("惜-清潔用品");
      expect(saved.querySelector(".source-badge--treasure")?.textContent).toContain("1 / 7 項符合");
      expect(root.querySelector(".favorite-filters__count")?.textContent).toContain("符合 1 / 7 項");
      expect(saved.querySelector(".product-panel--food .product-list")?.textContent)
        .toContain("友善便當");
      expect(root.querySelectorAll("#nearby .product-panel--treasure .product-list li"))
        .toHaveLength(7);
      expect(root.querySelector("#nearby .source-badge--treasure")?.textContent)
        .toContain("7 項明細");
      expect(root.querySelector("#nearby .product-list__labels")).toBeNull();
      expect(root.querySelector<HTMLDetailsElement>("#favorites .store-card details")?.open).toBe(true);

      setInput("#favorite-category", "alcohol");
      expect(favoriteCard("全家台鐵西店").querySelector(".product-panel--treasure")?.textContent)
        .toContain("目前沒有符合篩選的挖寶商品");
      expect(root.querySelector("#nearby .store-card")).not.toBeNull();
      setInput("#store-search", "台鐵西");
      expect(root.querySelector("#favorites .store-card")).not.toBeNull();
      expect(root.querySelector("#nearby .store-card")).not.toBeNull();
      act(() => button(/清除篩選/).click());
      expect(root.querySelectorAll("#favorites .product-panel--treasure .product-list li")).toHaveLength(7);
      expect(root.querySelector<HTMLSelectElement>("#favorite-category")?.value).toBe("all");
      act(() => savedDetails.querySelector("summary")!.click());
      expect(savedDetails.open).toBe(false);
      expect(client.load).toHaveBeenCalledTimes(2);
    });

    it("distinguishes loading, empty map products, missing stores and filtered-out products", async () => {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([
        { code: "018558", name: "全家台鐵西店" },
        { code: "009999", name: "全家大安店" },
        { code: "000001", name: "全家舊收藏" },
      ]));
      const emptyStore = makeStore({ info: [] });
      const nonmatchingStore = makeStore({
        oldPKey: "009999",
        name: "全家大安店",
        info: [{
          name: "生活好物",
          categories: [{ name: "用品", products: [{ name: "一般用品", qty: 1 }] }],
        }],
      });
      const client: MapDataClient = {
        load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => ({
          stores: source === "treasure" ? [emptyStore, nonmatchingStore] : [],
          fetchedAt: Date.now(),
          fromCache: false,
        })),
      };
      act(() => render(<App client={client} geolocation={null} />, root));
      setInput("#favorite-category", "food");
      expect(favoriteCard("全家台鐵西店").querySelector(".product-panel--treasure")?.textContent)
        .toContain("正在查詢這張地圖");
      expect(favoriteCard("全家台鐵西店").querySelector(".product-panel--treasure")?.textContent)
        .not.toContain("沒有符合篩選");
      await settleQueries();

      expect(favoriteCard("全家台鐵西店").querySelector(".product-panel--treasure")?.textContent)
        .toContain("地圖回傳此店，但未提供可列出的商品明細");
      expect(favoriteCard("全家大安店").querySelector(".product-panel--treasure")?.textContent)
        .toContain("目前沒有符合篩選的挖寶商品");
      expect(favoriteCard("全家舊收藏").querySelector(".product-panel--treasure")?.textContent)
        .toContain("未回傳此店商品資料");
      expect(root.querySelectorAll("#favorites .store-card")).toHaveLength(3);
      expect(root.querySelector("#favorites .store-list")?.textContent).not.toContain("已缺貨");
    });

    it("keeps successful food products and error status when treasure lookup fails under a filter", async () => {
      saveFixtureFavorite();
      const client: MapDataClient = {
        load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => {
          if (source === "treasure") throw new MapApiError("service", "挖寶讀取失敗");
          return {
            stores: [makeStore({ info: [{
              name: "友善食光",
              categories: [{ name: "鮮食", products: [{ name: "友善便當", qty: 2 }] }],
            }] })],
            fetchedAt: Date.now(),
            fromCache: false,
          };
        }),
      };
      act(() => render(<App client={client} geolocation={null} />, root));
      setInput("#favorite-discount", "未知");
      await settleQueries();

      const saved = favoriteCard("全家台鐵西店");
      expect(saved.querySelector(".source-badge--treasure")?.textContent).toContain("讀取失敗");
      expect(saved.querySelector(".product-panel--treasure")?.textContent)
        .toContain("挖寶讀取失敗");
      expect(saved.querySelector(".product-panel--treasure")?.textContent).not.toContain("沒有符合篩選");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("友善便當");
      expect(saved.querySelector(".product-panel--food")?.textContent).not.toContain("折扣未知");
      expect(root.querySelector(".source-status--treasure [role='alert']")?.textContent)
        .toContain("挖寶讀取失敗");
    });
  });

  describe("safe favorite management and mobile navigation", () => {
    it("does not remove a store from browse cards; management can cancel or confirm a named removal", async () => {
      saveFixtureFavorite();
      act(() => render(<App client={fixtureClient()} geolocation={null} />, root));
      setInput("#area", "taipei");
      submit("#area");
      await settleQueries();

      expect(root.querySelector("#favorites .favorite-button")?.tagName).toBe("SPAN");
      expect(root.querySelector("#nearby .favorite-button")?.tagName).toBe("SPAN");
      expect(root.querySelector("#favorites button[aria-label^='移除收藏']")).toBeNull();
      expect(root.querySelector("#nearby button[aria-label^='移除收藏']")).toBeNull();
      const manager = root.querySelector<HTMLDetailsElement>("#manage-favorites details")!;
      expect(manager.open).toBe(false);
      act(() => manager.querySelector("summary")!.click());
      const remove = button(/準備移除收藏：全家台鐵西店/);
      act(() => remove.click());
      expect(document.activeElement?.textContent).toBe("取消");
      expect(manager.textContent).toContain("確定要從此裝置的收藏移除「全家台鐵西店」");
      expect(manager.textContent).toContain("店代碼 018558");
      expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toHaveLength(1);
      act(() => button(/^取消$/).click());
      expect(document.activeElement).toBe(remove);
      expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toHaveLength(1);

      act(() => remove.click());
      act(() => button(/^確認移除$/).click());
      expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual([]);
      expect(root.querySelector("#favorites")?.textContent).toContain("還沒有收藏的分店");
      expect(document.activeElement?.id).toBe("manage-favorites-title");
      expect(root.querySelector("#nearby .store-card")).not.toBeNull();
      act(() => button(/加入收藏：全家台鐵西店/).click());
      expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toHaveLength(1);
    });

    it("shows a keyboard-accessible return link only after scrolling", () => {
      const original = Object.getOwnPropertyDescriptor(window, "scrollY");
      try {
        act(() => render(<App client={fixtureClient()} geolocation={null} />, root));
        expect(root.querySelector(".back-to-top")).toBeNull();
        Object.defineProperty(window, "scrollY", { configurable: true, value: 600 });
        act(() => { window.dispatchEvent(new Event("scroll")); });
        const link = root.querySelector<HTMLAnchorElement>(".back-to-top");
        expect(link?.getAttribute("href")).toBe("#top");
        expect(link?.getAttribute("aria-label")).toBe("返回頁首");
        expect(root.querySelector("#top")).not.toBeNull();
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
        act(() => { window.dispatchEvent(new Event("scroll")); });
        expect(root.querySelector(".back-to-top")).toBeNull();
      } finally {
        if (original) Object.defineProperty(window, "scrollY", original);
        else Reflect.deleteProperty(window, "scrollY");
      }
    });
  });

  function stubNativeDialog(): () => void {
    const prototype = HTMLDialogElement.prototype;
    const originalShow = Object.getOwnPropertyDescriptor(prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(prototype, "close");
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
        this.querySelector<HTMLButtonElement>("[aria-label='關閉商品圖片視窗']")?.focus();
      },
    });
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    });
    return () => {
      if (originalShow) Object.defineProperty(prototype, "showModal", originalShow);
      else Reflect.deleteProperty(prototype, "showModal");
      if (originalClose) Object.defineProperty(prototype, "close", originalClose);
      else Reflect.deleteProperty(prototype, "close");
    };
  }

  describe("on-demand product image preview", () => {
    let restoreDialog: () => void;
    beforeEach(() => { restoreDialog = stubNativeDialog(); });
    afterEach(() => restoreDialog());

    it("loads images only when requested from either map/list, handles a broken image and restores focus", async () => {
      saveFixtureFavorite();
      const loadImage = vi.fn(async (code: string) =>
        `https://delivery-prod-img.family.com.tw/product/${code}.png`,
      );
      act(() => render(
        <App client={productFixtureClient()} imageClient={{ loadImage }} geolocation={null} />,
        root,
      ));
      setInput("#area", "taipei");
      submit("#area");
      await settleQueries();

      expect(loadImage).not.toHaveBeenCalled();
      expect(root.querySelector(".image-dialog img")).toBeNull();
      const foodButton = root.querySelector<HTMLButtonElement>(
        "#favorites .product-panel--food .product-list__image-button",
      )!;
      act(() => foodButton.click());
      expect(root.querySelector<HTMLDialogElement>(".image-dialog")?.open).toBe(true);
      expect(document.activeElement?.getAttribute("aria-label")).toBe("關閉商品圖片視窗");
      expect(loadImage).toHaveBeenCalledWith("0789123", expect.any(AbortSignal));
      await act(async () => { await Promise.resolve(); });
      const image = root.querySelector<HTMLImageElement>(".image-dialog img")!;
      expect(image.src).toBe("https://delivery-prod-img.family.com.tw/product/0789123.png");
      expect(image.alt).toContain("友善便當");
      expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
      act(() => { image.dispatchEvent(new Event("error")); });
      expect(root.querySelector(".image-dialog [role='alert']")?.textContent)
        .toContain("圖片連結無法載入");
      expect(root.querySelector(".image-dialog img")).toBeNull();
      act(() => button(/關閉商品圖片視窗/).click());
      expect(root.querySelector<HTMLDialogElement>(".image-dialog")?.open).toBe(false);
      expect(document.activeElement).toBe(foodButton);

      const nearbyButton = root.querySelector<HTMLButtonElement>(
        "#nearby .product-panel--treasure .product-list__image-button",
      )!;
      act(() => nearbyButton.click());
      await act(async () => { await Promise.resolve(); });
      expect(loadImage).toHaveBeenCalledWith("0065108", expect.any(AbortSignal));
      act(() => button(/關閉商品圖片視窗/).click());
      expect(document.activeElement).toBe(nearbyButton);
      expect(root.querySelector("#favorites .product-panel--food .product-list__image-unavailable")
        ?.textContent).toContain("未提供圖片代碼");
    });

    it("aborts a closed preview and reports an unavailable official image without inventing one", async () => {
      saveFixtureFavorite();
      let finish!: (url: string) => void;
      const pending = new Promise<string>((resolve) => { finish = resolve; });
      const loadImage = vi.fn((_code: string, _signal?: AbortSignal): Promise<string> => pending);
      act(() => render(<App client={fixtureClient()} imageClient={{ loadImage }} geolocation={null} />, root));
      await settleQueries();

      const opener = root.querySelector<HTMLButtonElement>(
        "#favorites .product-panel--treasure .product-list__image-button",
      )!;
      act(() => opener.click());
      expect(root.querySelector(".image-dialog [role='status']")?.textContent)
        .toContain("正在向官方查詢圖片");
      expect(root.querySelector(".image-dialog img")).toBeNull();
      const signal = loadImage.mock.calls[0][1]!;
      act(() => button(/關閉商品圖片視窗/).click());
      expect(signal.aborted).toBe(true);
      expect(document.activeElement).toBe(opener);
      await act(async () => {
        finish("https://delivery-prod-img.family.com.tw/product/0065108.png");
        await Promise.resolve();
      });
      expect(root.querySelector(".image-dialog img")).toBeNull();

      loadImage.mockRejectedValueOnce(new MapApiError("response", "官方目前未提供這件商品的圖片。"));
      act(() => opener.click());
      await act(async () => { await Promise.resolve(); });
      expect(root.querySelector(".image-dialog [role='alert']")?.textContent)
        .toContain("官方目前未提供這件商品的圖片");
      expect(root.querySelector(".image-dialog img")).toBeNull();
    });
  });

  it("uses the region fallback after denial and retains a favorite", async () => {
    const { client } = renderDeniedLocationApp();
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
    expect(root.querySelector(".search-preview__saved")?.textContent).toBe("已收藏");
    expect(root.querySelector(".search-preview li button[aria-label^='移除']")).toBeNull();
    expect(root.querySelector("#favorites .manage-favorites-link")).not.toBeNull();
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
    setInput("#favorite-category", "food");
    setInput("#favorite-discount", "5折");
    expect(root.querySelector("#favorites .favorite-filters__count")?.textContent)
      .toContain("符合 1 / 1 項");
    expect(root.querySelector("#favorites .store-card .source-badge--treasure")?.textContent)
      .toContain("1 / 1 項符合");
    expect(root.querySelector("#nearby .store-card .source-badge--treasure")?.textContent)
      .toContain("1 項明細");
    expect(client.load).toHaveBeenCalledTimes(4);
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
