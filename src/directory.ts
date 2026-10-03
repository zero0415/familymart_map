import { z } from "zod";
import type { OfficialStore } from "./api";

const rawStoreSchema = z.object({
  pkeynew: z.string().regex(/^\d{6}$/),
  Name: z.string().trim().min(1).max(100),
  addr: z.string().trim().min(1).max(200),
  serid: z.string().regex(/^[156]\d{4}$/),
  px_wgs84: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  py_wgs84: z.string().regex(/^-?\d+(?:\.\d+)?$/),
});

const directoryStoreSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(200),
  latitude: z.number().finite().min(21).max(27).nullable(),
  longitude: z.number().finite().min(115).max(123).nullable(),
}).strict().refine(
  (store) => (store.latitude === null) === (store.longitude === null),
);

const directorySchema = z.object({
  updatedAt: z.iso.datetime(),
  unlocatedCount: z.number().int().nonnegative(),
  stores: z.array(directoryStoreSchema).min(4_000).max(10_000),
}).strict();

export type DirectoryStore = z.infer<typeof directoryStoreSchema>;
export type StoreDirectory = z.infer<typeof directorySchema>;

export class DirectoryError extends Error {
  readonly kind: "http" | "network" | "response";

  constructor(
    kind: "http" | "network" | "response",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "DirectoryError";
    this.kind = kind;
  }
}

export function deriveMapStoreCode(serid: string): string {
  if (!/^[156]\d{4}$/.test(serid)) {
    throw new DirectoryError("response", "官方店舖目錄的 serid 格式不正確，無法對應商品地圖店代碼。");
  }
  const code = Number(serid) - (serid[0] === "1" ? 10_000 : 40_000);
  if (!Number.isInteger(code) || code < 0 || code > 29_999) {
    throw new DirectoryError("response", "官方店舖目錄的 serid 超出可對應的店代碼範圍。");
  }
  return String(code).padStart(6, "0");
}

export function parseStoreDirectory(value: unknown): StoreDirectory {
  const parsed = directorySchema.safeParse(value);
  if (!parsed.success) {
    throw new DirectoryError(
      "response",
      "店舖目錄快照格式不正確，無法安全列出 3 公里內的分店。",
      parsed.error,
    );
  }
  const directory = parsed.data;
  if (
    new Set(directory.stores.map((store) => store.code)).size !== directory.stores.length ||
    directory.stores.filter((store) => store.latitude === null).length !== directory.unlocatedCount
  ) {
    throw new DirectoryError("response", "店舖目錄快照含重複店代碼或座標筆數不一致，已停止使用。");
  }
  return directory;
}

export function buildStoreDirectory(raw: unknown, updatedAt: string): StoreDirectory {
  const rows = z.array(rawStoreSchema).safeParse(raw);
  if (!rows.success || rows.data.length < 4_000 || rows.data.length > 10_000) {
    throw new DirectoryError(
      "response",
      "官方店舖目錄格式錯誤或筆數異常；已停止發布，避免把不完整名單當成全臺店舖。",
      rows.success ? undefined : rows.error,
    );
  }

  const catalogCodes = new Set<string>();
  const mapCodes = new Set<string>();
  let unlocatedCount = 0;
  const stores = rows.data.map((row) => {
    const code = deriveMapStoreCode(row.serid);
    if (catalogCodes.has(row.pkeynew) || mapCodes.has(code)) {
      throw new DirectoryError("response", "官方店舖目錄含重複的新店碼或商品地圖舊店碼，已停止發布。");
    }
    catalogCodes.add(row.pkeynew);
    mapCodes.add(code);

    const latitude = Number(row.py_wgs84);
    const longitude = Number(row.px_wgs84);
    const located =
      Number.isFinite(latitude) && latitude >= 21 && latitude <= 27 &&
      Number.isFinite(longitude) && longitude >= 115 && longitude <= 123;
    if (!located) unlocatedCount += 1;
    return {
      code,
      name: row.Name,
      address: row.addr,
      latitude: located ? latitude : null,
      longitude: located ? longitude : null,
    };
  });

  if (unlocatedCount > 10) {
    throw new DirectoryError("response", "官方店舖目錄有過多異常座標，已停止發布。");
  }
  return parseStoreDirectory({ updatedAt, unlocatedCount, stores });
}

export function matchesDirectoryStore(store: DirectoryStore, row: OfficialStore): boolean {
  if (store.latitude === null || store.longitude === null || store.code !== row.oldPKey) return false;
  const normalizeName = (name: string) => name.normalize("NFKC").replace(/\s+/g, "");
  if (normalizeName(store.name) !== normalizeName(row.name)) return false;
  const latitudeMeters = (store.latitude - row.latitude) * 111_320;
  const longitudeMeters =
    (store.longitude - row.longitude) * 111_320 * Math.cos((store.latitude * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters) <= 150;
}

export function isDirectoryStale(updatedAt: string, now = Date.now()): boolean {
  return now - Date.parse(updatedAt) > 48 * 60 * 60_000;
}

export interface DirectoryDataClient {
  load(): Promise<StoreDirectory>;
}

export class DirectoryClient implements DirectoryDataClient {
  private cached: StoreDirectory | null = null;
  private inflight: Promise<StoreDirectory> | null = null;
  private readonly request: typeof fetch;

  constructor(request: typeof fetch = (...args) => fetch(...args)) {
    this.request = request;
  }

  load(): Promise<StoreDirectory> {
    if (this.cached) return Promise.resolve(this.cached);
    if (!this.inflight) {
      this.inflight = this.fetchDirectory().then((directory) => {
        this.cached = directory;
        return directory;
      }).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchDirectory(): Promise<StoreDirectory> {
    let response: Response;
    try {
      response = await this.request(`${import.meta.env.BASE_URL}store-directory.json`, {
        credentials: "omit",
        mode: "same-origin",
        referrerPolicy: "no-referrer",
        cache: "no-cache",
      });
    } catch (error) {
      throw new DirectoryError("network", "無法載入店舖目錄快照；3 公里名單暫時無法確認。", error);
    }
    if (!response.ok) {
      throw new DirectoryError(
        "http",
        `店舖目錄快照暫時無法讀取（HTTP ${response.status}）；3 公里名單暫時無法確認。`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new DirectoryError("response", "店舖目錄快照不是可讀取的 JSON；3 公里名單暫時無法確認。", error);
    }
    return parseStoreDirectory(payload);
  }
}
