import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { MapApiError, type MapDataClient, type MapQuery, type MapResult } from "./api";
import { FAVORITES_KEY } from "./favorites";
import type { GeolocationClient } from "./location";
import { PRICE_NOTES_KEY } from "./price-notes";
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

function sharedCodeClient(): MapDataClient {
  const first = makeStore({
    info: [{
      name: "美味挖寶",
      categories: [{
        name: "食品",
        products: [
          { name: "惜—食品甲", qty: 2, code: "0065108" },
          { name: "惜—食品甲", qty: 1 },
        ],
      }],
    }],
  });
  const second = makeStore({
    oldPKey: "019999",
    name: "全家另一店",
    latitude: 25.0473,
    info: [{
      name: "生活好物",
      categories: [{
        name: "用品",
        products: [
          { name: "跨店不同名稱", qty: 1, code: "0065108" },
          { name: "惜—食品甲", qty: 1, code: "0099999" },
        ],
      }],
    }],
  });
  const food = makeStore({
    info: [{
      name: "友善食光",
      categories: [{
        name: "鮮食",
        products: [{ name: "友善便當", qty: 1, code: "0065108" }],
      }],
    }],
  });
  return {
    load: vi.fn(async ({ source }: MapQuery): Promise<MapResult> => ({
      stores: source === "treasure" ? [first, second] : [food],
      fetchedAt: Date.now(),
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

function nearbyCard(name: string): HTMLElement {
  const card = [...root.querySelectorAll<HTMLElement>("#nearby .store-card")].find(
    (element) => element.querySelector("h3")?.textContent === name,
  );
  if (!card) throw new Error(`Nearby card not found: ${name}`);
  return card;
}

function productRow(card: HTMLElement, source: "food" | "treasure", name: string): HTMLElement {
  const row = [...card.querySelectorAll<HTMLElement>(`.product-panel--${source} .product-list li`)]
    .find((element) => element.querySelector(".product-list__name")?.textContent === name);
  if (!row) throw new Error(`Product row not found: ${source} / ${name}`);
  return row;
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
      expect(saved.querySelector(".product-panel--treasure")?.textContent).toContain("估算3折");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("友善便當");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("0 件");
      expect(saved.querySelector(".product-panel--food")?.textContent).toContain("資料時間");
      expect(saved.querySelector(".product-panel--food")?.textContent).not.toMatch(/5折|3折|折扣未知/);
      expect(root.querySelector("#favorites")?.textContent).toContain("非官方折扣或實際結帳價");
      expect(root.querySelector("#favorite-discount")).toBeNull();
      expect(root.querySelector("#favorites")?.textContent).not.toContain("自訂折數");
      for (const [name, label] of [
        ["惜—食品甲", "估算5折"],
        ["一般食品乙", "折扣未知"],
        ["惜-清潔用品", "估算3折"],
        ["一般用品", "估算5折"],
        ["惜—酒品", "折扣未知"],
        ["一般酒品", "折扣未知"],
        ["惜—神秘包", "類別／折扣未知"],
      ]) {
        expect(productRow(saved, "treasure", name).querySelector(".product-list__labels")?.textContent)
          .toContain(label);
      }
      expect(saved.querySelector(".product-panel--food .product-list__labels")).toBeNull();

      setInput("#favorite-category", "supplies");
      setInput("#favorite-prefix", "saving");
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
      expect(root.querySelector("#nearby .product-panel--treasure .product-list__labels")
        ?.textContent).toContain("5折");
      expect(root.querySelector("#nearby .product-panel--food .product-list__labels")).toBeNull();
      expect(root.querySelector<HTMLDetailsElement>("#favorites .store-card details")?.open).toBe(true);

      setInput("#favorite-category", "unknown");
      setInput("#favorite-prefix", "regular");
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
      setInput("#favorite-category", "food");
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
      act(() => manager.querySelector<HTMLButtonElement>(".favorite-manager__actions button:first-child")!.click());
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

  describe("personal original price notes", () => {
    it("shows receipt prices by code in both store lists without pricing other products or creating a local note", async () => {
      saveFixtureFavorite();
      const client = sharedCodeClient();
      act(() => render(<App client={client} geolocation={null} />, root));

      const catalogue = root.querySelector("#receipt-prices");
      expect(catalogue?.querySelectorAll(".receipt-price-list li")).toHaveLength(8);
      expect(catalogue?.textContent).toContain("2026-10-02");
      expect(catalogue?.textContent).toContain("惜—星星脆哈蜜瓜牛奶口味");
      expect(catalogue?.querySelector(".receipt-price-list li small")?.textContent)
        .toBe("商品代碼 0065108");
      expect(root.querySelector<HTMLAnchorElement>("nav a[href='#receipt-prices']")).not.toBeNull();
      expect(root.querySelector("#price-notes .price-manager")).toBeNull();
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBeNull();

      setInput("#area", "taipei");
      submit("#area");
      await settleQueries();
      const favorite = favoriteCard("全家台鐵西店");
      const nearby = nearbyCard("全家另一店");
      act(() => favorite.querySelector<HTMLElement>(".store-card__details > summary")!.click());
      act(() => nearby.querySelector<HTMLElement>(".store-card__details > summary")!.click());

      for (const row of [
        productRow(favorite, "treasure", "惜—食品甲"),
        productRow(nearby, "treasure", "跨店不同名稱"),
      ]) {
        expect(row.querySelector(".product-list__receipt-price")?.textContent)
          .toContain("收據原價：NT$39");
        expect(row.querySelector(".product-list__receipt-price")?.textContent)
          .toContain("該筆五折推算：NT$20");
        expect(row.querySelector(".product-list__receipt-price")?.textContent)
          .toContain("使用者提供收據・2026-10-02");
        expect(row.querySelector(".product-list__unrecorded")?.textContent)
          .toContain("尚未記錄個人原價");
        expect(row.querySelector(".product-list__labels")?.textContent).toContain("估算5折");
      }
      expect(favorite.querySelector(".product-panel__receipt-note")?.textContent)
        .toContain("不保證現在或未來");
      expect(productRow(nearby, "treasure", "惜—食品甲")
        .querySelector(".product-list__receipt-price")).toBeNull();
      const noCode = [...favorite.querySelectorAll(".product-panel--treasure .product-list li")]
        .find((row) => row.textContent?.includes("未提供商品代碼"))!;
      expect(noCode.querySelector(".product-list__receipt-price")).toBeNull();
      expect(productRow(favorite, "food", "友善便當")
        .querySelector(".product-list__receipt-price")).toBeNull();
      expect(productRow(favorite, "food", "友善便當")
        .querySelector(".product-list__image-button")).not.toBeNull();
      expect(root.querySelector("#price-notes .price-manager")).toBeNull();
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBeNull();
    });

    it("keeps an existing personal original price editable and removable without changing the receipt price", async () => {
      saveFixtureFavorite();
      const savedNote = [{ code: "0065108", name: "我的舊紀錄", priceCents: 4_200 }];
      window.localStorage.setItem(PRICE_NOTES_KEY, JSON.stringify(savedNote));
      act(() => render(<App client={sharedCodeClient()} geolocation={null} />, root));
      await settleQueries();

      const row = productRow(favoriteCard("全家台鐵西店"), "treasure", "惜—食品甲");
      expect(row.querySelector(".product-list__receipt-price")?.textContent)
        .toContain("該筆五折推算：NT$20");
      expect(row.querySelector(".product-list__price")?.textContent)
        .toContain("個人紀錄原價／非官方：NT$42");
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe(JSON.stringify(savedNote));
      expect(root.querySelectorAll("#price-notes .price-manager li")).toHaveLength(1);

      const manager = root.querySelector<HTMLDetailsElement>("#price-notes .price-note-controls")!;
      act(() => manager.querySelector("summary")!.click());
      act(() => manager.querySelector<HTMLButtonElement>(
        ".price-note-controls__actions button:last-child",
      )!.click());
      act(() => button(/^確認清除原價$/).click());
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe("[]");
      expect(row.querySelector(".product-list__receipt-price")?.textContent)
        .toContain("收據原價：NT$39");
      expect(row.querySelector(".product-list__unrecorded")?.textContent)
        .toContain("尚未記錄個人原價");
      expect(root.querySelector("#price-notes .price-manager")).toBeNull();
      expect(root.querySelectorAll("#receipt-prices .receipt-price-list li")).toHaveLength(8);
    });

    it("shares only identical product codes across favorite and nearby stores, persists and edits", async () => {
      saveFixtureFavorite();
      const client = sharedCodeClient();
      act(() => render(<App client={client} geolocation={null} />, root));
      setInput("#area", "taipei");
      submit("#area");
      await settleQueries();

      const favorite = favoriteCard("全家台鐵西店");
      const nearby = nearbyCard("全家另一店");
      act(() => favorite.querySelector<HTMLElement>(".store-card__details > summary")!.click());
      act(() => nearby.querySelector<HTMLElement>(".store-card__details > summary")!.click());
      expect(root.querySelectorAll(".product-list__price")).toHaveLength(0);
      expect(root.querySelector("#price-notes")?.textContent).toContain("尚無個人原價紀錄");
      expect(root.querySelector<HTMLAnchorElement>("nav a[href='#price-notes']")).not.toBeNull();

      const coded = productRow(favorite, "treasure", "惜—食品甲");
      expect(coded.querySelector("small")?.textContent).toBe("食品");
      const editor = coded.querySelector<HTMLDetailsElement>(".price-note-controls")!;
      act(() => editor.querySelector("summary")!.click());
      const amount = "#price-input-favorite-018558-treasure-0-0065108";
      expect(root.querySelector<HTMLInputElement>(amount)?.inputMode).toBe("decimal");
      expect(root.querySelector<HTMLInputElement>(amount)?.getAttribute("aria-describedby"))
        .toContain("price-hint-");
      setInput(amount, "0");
      submit(amount);
      expect(editor.querySelector("[role='alert']")?.textContent).toContain("正數原價");
      expect(root.querySelector<HTMLInputElement>(amount)?.getAttribute("aria-invalid")).toBe("true");
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBeNull();

      setInput(amount, "39.50");
      submit(amount);
      expect(JSON.parse(window.localStorage.getItem(PRICE_NOTES_KEY)!)).toEqual([
        { code: "0065108", name: "惜—食品甲", priceCents: 3950 },
      ]);
      expect(productRow(favorite, "treasure", "惜—食品甲").querySelector(".product-list__price")
        ?.textContent).toContain("個人紀錄原價／非官方：NT$39.50");
      expect(productRow(nearby, "treasure", "跨店不同名稱").querySelector(".product-list__price")
        ?.textContent).toContain("NT$39.50");
      expect(productRow(favorite, "food", "友善便當").querySelector(".product-list__price")
        ?.textContent).toContain("NT$39.50");
      expect(productRow(nearby, "treasure", "惜—食品甲").querySelector(".product-list__price"))
        .toBeNull();
      const noCode = [...favorite.querySelectorAll(".product-panel--treasure .product-list li")]
        .find((row) => row.textContent?.includes("未提供商品代碼"))!;
      expect(noCode.textContent).toContain("無法紀錄原價");
      expect(noCode.querySelector(".price-note-controls")).toBeNull();
      expect(noCode.querySelector(".product-list__price")).toBeNull();
      expect(favorite.querySelector(".product-panel--food .product-list__labels")).toBeNull();
      expect(root.textContent).not.toContain("NT$19.75");
      expect(client.load).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(vi.mocked(client.load).mock.calls)).not.toContain("priceCents");

      act(() => render(null, root));
      act(() => render(<App client={sharedCodeClient()} geolocation={null} />, root));
      expect(root.querySelector("#price-notes .price-manager")?.textContent).toContain("NT$39.50");
      await settleQueries();
      expect(productRow(favoriteCard("全家台鐵西店"), "food", "友善便當")
        .querySelector(".product-list__price")?.textContent).toContain("NT$39.50");
      const manager = root.querySelector<HTMLDetailsElement>("#price-notes .price-note-controls")!;
      act(() => manager.querySelector("summary")!.click());
      setInput("#price-input-manager-0065108", "42");
      submit("#price-input-manager-0065108");
      expect(root.querySelector("#price-notes .price-manager")?.textContent).toContain("NT$42");
      expect(JSON.parse(window.localStorage.getItem(PRICE_NOTES_KEY)!)[0].priceCents).toBe(4200);
      expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toHaveLength(1);
    });

    it("edits and clears an off-map record without touching favorites", async () => {
      saveFixtureFavorite();
      const previousFavorites = window.localStorage.getItem(FAVORITES_KEY);
      window.localStorage.setItem(PRICE_NOTES_KEY, JSON.stringify([
        { code: "0065108", name: "曾經出現的商品", priceCents: 3500 },
      ]));
      const emptyClient: MapDataClient = {
        load: vi.fn(async (): Promise<MapResult> => ({
          stores: [],
          fetchedAt: Date.now(),
          fromCache: false,
        })),
      };
      act(() => render(<App client={emptyClient} geolocation={null} />, root));
      await settleQueries();

      const manager = root.querySelector<HTMLDetailsElement>("#price-notes .price-note-controls")!;
      expect(root.querySelector("#price-notes")?.textContent)
        .toContain("曾經出現的商品");
      expect(root.querySelector("#favorites")?.textContent).toContain("未回傳此店商品資料");
      act(() => manager.querySelector("summary")!.click());
      setInput("#price-input-manager-0065108", "48.25");
      submit("#price-input-manager-0065108");
      expect(root.querySelector("#price-notes .price-manager")?.textContent).toContain("NT$48.25");
      act(() => manager.querySelector("summary")!.click());
      act(() => manager.querySelector<HTMLButtonElement>(".price-note-controls__actions button:last-child")!.click());
      expect(manager.textContent).toContain("確定清除「曾經出現的商品」");
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toContain("4825");
      expect(document.activeElement?.textContent).toBe("取消清除");
      act(() => button(/^取消清除$/).click());
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toContain("4825");
      act(() => manager.querySelector<HTMLButtonElement>(".price-note-controls__actions button:last-child")!.click());
      act(() => button(/^確認清除原價$/).click());
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe("[]");
      expect(root.querySelector("#price-notes")?.textContent).toContain("尚無個人原價紀錄");
      expect(document.activeElement?.id).toBe("price-notes-title");
      expect(window.localStorage.getItem(FAVORITES_KEY)).toBe(previousFavorites);
      expect(emptyClient.load).toHaveBeenCalledTimes(2);
    });

    it("keeps corrupt price storage untouched and reports temporary-only edits", async () => {
      saveFixtureFavorite();
      const previousFavorites = window.localStorage.getItem(FAVORITES_KEY);
      window.localStorage.setItem(PRICE_NOTES_KEY, "{broken");
      act(() => render(<App client={productFixtureClient()} geolocation={null} />, root));
      await settleQueries();
      const persistedFavorites = window.localStorage.getItem(FAVORITES_KEY);
      expect(root.querySelector("#price-notes [role='alert']")?.textContent)
        .toContain("為避免覆寫原資料");
      const editor = productRow(favoriteCard("全家台鐵西店"), "treasure", "惜—食品甲")
        .querySelector<HTMLDetailsElement>(".price-note-controls")!;
      act(() => editor.querySelector("summary")!.click());
      setInput("#price-input-favorite-018558-treasure-0-0065108", "39");
      submit("#price-input-favorite-018558-treasure-0-0065108");
      expect(root.querySelector("#price-notes .price-manager")?.textContent).toContain("NT$39");
      expect(root.querySelector("#price-notes [role='status']")?.textContent)
        .toContain("重新載入後不會保留");
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe("{broken");
      expect(window.localStorage.getItem(FAVORITES_KEY)).toBe(persistedFavorites);
      expect(JSON.parse(persistedFavorites!)[0].code)
        .toBe(JSON.parse(previousFavorites!)[0].code);

      act(() => render(null, root));
      act(() => render(<App client={productFixtureClient()} geolocation={null} />, root));
      expect(root.querySelector("#price-notes .price-manager")).toBeNull();
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe("{broken");
    });

    it.each(["read", "write"] as const)(
      "reports %s failure for price storage without damaging other local data",
      async (failure) => {
        saveFixtureFavorite();
        const previousFavorites = window.localStorage.getItem(FAVORITES_KEY);
        const previousPrice = JSON.stringify([
          { code: "0065108", name: "之前的原價", priceCents: 5000 },
        ]);
        if (failure === "read") window.localStorage.setItem(PRICE_NOTES_KEY, previousPrice);
        const storage = new Proxy(window.localStorage, {
          get(target, property) {
            if (property === "getItem") {
              return (key: string) => {
                if (failure === "read" && key === PRICE_NOTES_KEY) throw new Error("blocked");
                return target.getItem(key);
              };
            }
            if (property === "setItem") {
              return (key: string, value: string) => {
                if (failure === "write" && key === PRICE_NOTES_KEY) throw new Error("quota");
                target.setItem(key, value);
              };
            }
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        act(() => render(
          <App client={productFixtureClient()} geolocation={null} storage={storage} />,
          root,
        ));
        await settleQueries();
        const persistedFavorites = window.localStorage.getItem(FAVORITES_KEY);
        if (failure === "read") {
          expect(root.querySelector("#price-notes [role='alert']")?.textContent)
            .toContain("不允許讀取");
        }
        const editor = productRow(favoriteCard("全家台鐵西店"), "treasure", "惜—食品甲")
          .querySelector<HTMLDetailsElement>(".price-note-controls")!;
        act(() => editor.querySelector("summary")!.click());
        setInput("#price-input-favorite-018558-treasure-0-0065108", "39");
        submit("#price-input-favorite-018558-treasure-0-0065108");
        expect(root.querySelector("#price-notes .price-manager")?.textContent).toContain("NT$39");
        expect(root.querySelector("#price-notes [role='alert']")?.textContent)
          .toContain(failure === "read" ? "不允許讀取" : "無法儲存");
        expect(root.querySelector("#price-notes [role='status']")?.textContent)
          .toContain("重新載入後不會保留");
        expect(window.localStorage.getItem(PRICE_NOTES_KEY))
          .toBe(failure === "read" ? previousPrice : null);
        expect(window.localStorage.getItem(FAVORITES_KEY)).toBe(persistedFavorites);
        expect(JSON.parse(persistedFavorites!)[0].code)
          .toBe(JSON.parse(previousFavorites!)[0].code);
      },
    );
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
    setInput("#favorite-prefix", "saving");
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
