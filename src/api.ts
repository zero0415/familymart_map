import { z } from "zod";

export const MAP_SOURCES = {
  food: {
    name: "友善食光",
    projectCode: "202106302",
    url: "https://foodmap.family.com.tw/",
  },
  treasure: {
    name: "挖寶專區",
    projectCode: "202208202",
    url: "https://dz5iap6aj0of3.cloudfront.net/",
  },
} as const;

export type MapSource = keyof typeof MAP_SOURCES;
export const SOURCE_IDS: readonly MapSource[] = ["food", "treasure"];

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const quantitySchema = z.number().int().nonnegative().nullish();
export const PRODUCT_CODE_PATTERN = /^\d{1,20}$/;
const productSchema = z.object({
  name: z.string().trim().min(1),
  qty: quantitySchema,
  code: z.string().regex(PRODUCT_CODE_PATTERN).nullish(),
});
const categorySchema = z.object({
  name: z.string().trim().min(1),
  products: z.array(productSchema),
});
const storeSchema = z.object({
  oldPKey: z.string().regex(/^\d{1,12}$/),
  name: z.string().trim().min(1),
  address: z.string().nullish(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  distance: z.number().finite().nonnegative().nullish(),
  updateDate: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)))
    .nullish(),
  info: z.array(
    z.object({
      name: z.string().trim().min(1),
      categories: z.array(categorySchema),
    }),
  ),
});

export type OfficialStore = z.infer<typeof storeSchema>;

export class MapApiError extends Error {
  constructor(
    public readonly kind: "http" | "network" | "response" | "service" | "input",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "MapApiError";
  }
}

export function parseMapResponse(value: unknown): OfficialStore[] {
  const envelope = z
    .object({ code: z.number(), data: z.unknown().optional() })
    .safeParse(value);

  if (!envelope.success) {
    throw new MapApiError(
      "response",
      "官方地圖回傳格式已變更，無法安全顯示資料。請改至官方地圖查看。",
      envelope.error,
    );
  }
  if (envelope.data.code !== 1) {
    throw new MapApiError(
      "service",
      `官方地圖回報錯誤（代碼 ${envelope.data.code}）。請稍後重試。`,
    );
  }

  const stores = z.array(storeSchema).safeParse(envelope.data.data);
  if (!stores.success) {
    throw new MapApiError(
      "response",
      "官方地圖回傳格式已變更，無法安全顯示資料。請改至官方地圖查看。",
      stores.error,
    );
  }

  const codes = new Set<string>();
  for (const store of stores.data) {
    if (codes.has(store.oldPKey)) {
      throw new MapApiError(
        "response",
        "官方地圖回傳重複的店代碼，無法安全顯示資料。請稍後重試。",
      );
    }
    codes.add(store.oldPKey);
  }

  return stores.data;
}

export const CACHE_DURATION_MS = 5 * 60_000;
const API_URL = "https://stamp.family.com.tw/api/maps/MapProductInfo";
const PRODUCT_IMAGE_API_URL = "https://stamp.family.com.tw/api/maps/MapProductImage";
const PRODUCT_IMAGE_HOST = "delivery-prod-img.family.com.tw";

export interface MapResult {
  stores: OfficialStore[];
  fetchedAt: number;
  fromCache: boolean;
}

interface MapQueryBase {
  source: MapSource;
  favoriteCodes: readonly string[];
  signal?: AbortSignal;
  force?: boolean;
}

export type MapQuery = MapQueryBase &
  ({ position: Coordinates; postalCode?: never } | { postalCode: string; position?: never });

export interface MapDataClient {
  load(query: MapQuery): Promise<MapResult>;
}

export interface ProductImageClient {
  loadImage(productCode: string, signal?: AbortSignal): Promise<string>;
}

export class MapClient implements MapDataClient {
  private readonly cache = new Map<
    string,
    { stores: OfficialStore[]; fetchedAt: number }
  >();

  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  async load(query: MapQuery): Promise<MapResult> {
    const { source, favoriteCodes, signal, force = false } = query;
    const postalCode = query.postalCode ?? "";
    if (postalCode && !/^\d{3}$/.test(postalCode)) {
      throw new MapApiError("input", "郵遞區號須為 3 位數，未送出官方地圖查詢。");
    }
    let latitude = 0;
    let longitude = 0;
    if (!postalCode) {
      if (!query.position) {
        throw new MapApiError("input", "請提供查詢位置或三位數郵遞區號。");
      }
      latitude = Number(query.position.latitude.toFixed(4));
      longitude = Number(query.position.longitude.toFixed(4));
    }
    const codes = [...new Set(favoriteCodes)].sort();
    const key = JSON.stringify([source, postalCode, latitude, longitude, codes]);
    const cached = this.cache.get(key);
    if (
      !force &&
      cached &&
      this.now() - cached.fetchedAt < CACHE_DURATION_MS
    ) {
      return { ...cached, fromCache: true };
    }

    let response: Response;
    try {
      response = await this.request(API_URL, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectCode: MAP_SOURCES[source].projectCode,
          OldPKeys: codes,
          PostInfo: postalCode,
          Latitude: latitude,
          Longitude: longitude,
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new MapApiError(
        "network",
        "無法連線到官方地圖（網路或跨網域存取可能受阻）。請稍後重試。",
        error,
      );
    }

    if (!response.ok) {
      throw new MapApiError(
        "http",
        `官方地圖暫時無法回應（HTTP ${response.status}）。請稍後重試。`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new MapApiError(
        "response",
        "官方地圖未回傳可讀取的 JSON，無法顯示商品。請稍後重試。",
        error,
      );
    }

    const result = {
      stores: parseMapResponse(payload),
      fetchedAt: this.now(),
    };
    this.cache.set(key, result);
    return { ...result, fromCache: false };
  }
}

export class MapProductImageClient implements ProductImageClient {
  constructor(private readonly request: typeof fetch = (...args) => fetch(...args)) {}

  async loadImage(productCode: string, signal?: AbortSignal): Promise<string> {
    if (!PRODUCT_CODE_PATTERN.test(productCode)) {
      throw new MapApiError("input", "商品圖片代碼格式無效，無法查詢官方圖片。");
    }

    const url = new URL(PRODUCT_IMAGE_API_URL);
    url.searchParams.set("productId", productCode);
    let response: Response;
    try {
      response = await this.request(url.toString(), {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new MapApiError("network", "無法連線到官方商品圖片服務。請稍後重試。", error);
    }

    if (!response.ok) {
      throw new MapApiError(
        "http",
        `官方商品圖片服務暫時無法回應（HTTP ${response.status}）。請稍後重試。`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new MapApiError("response", "官方商品圖片服務未回傳可讀取的 JSON。", error);
    }

    const envelope = z.object({ code: z.number(), data: z.unknown().optional() }).safeParse(payload);
    if (!envelope.success) {
      throw new MapApiError("response", "官方商品圖片資料格式已變更，無法安全顯示圖片。", envelope.error);
    }
    if (envelope.data.code !== 1) {
      throw new MapApiError(
        "service",
        `官方商品圖片服務回報錯誤（代碼 ${envelope.data.code}）。請稍後重試。`,
      );
    }
    if (envelope.data.data == null) {
      throw new MapApiError("response", "官方目前未提供這件商品的圖片。");
    }

    const image = z.object({ imageUrl: z.string().trim().nullish() }).safeParse(envelope.data.data);
    if (!image.success) {
      throw new MapApiError("response", "官方商品圖片資料格式已變更，無法安全顯示圖片。", image.error);
    }
    if (!image.data.imageUrl) {
      throw new MapApiError("response", "官方目前未提供這件商品的圖片。");
    }

    const address = z.url().safeParse(image.data.imageUrl);
    if (!address.success) {
      throw new MapApiError("response", "官方商品圖片網址無效，已停止載入。", address.error);
    }
    const parsed = new URL(address.data);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== PRODUCT_IMAGE_HOST ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      throw new MapApiError("response", "官方商品圖片網址不安全，已停止載入。");
    }
    return parsed.href;
  }
}
