import { z } from "zod";

export const FAVORITES_KEY = "familymart-map:favorites:v1";
export const STORE_CODE_PATTERN = /^\d{1,12}$/;

const favoriteSchema = z
  .object({
    code: z.string().regex(STORE_CODE_PATTERN),
    name: z.string().trim().min(1),
    address: z.string().optional(),
  })
  .strict();

export type Favorite = z.infer<typeof favoriteSchema>;

export class FavoriteStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "FavoriteStorageError";
  }
}

export function decodeFavorites(raw: string | null): Favorite[] {
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new FavoriteStorageError(
      "裝置中的收藏資料無法解析；為避免覆寫原資料，本次收藏僅保留在目前頁面。",
      error,
    );
  }

  const parsed = z.array(favoriteSchema).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map((item) => item.code)).size !== parsed.data.length) {
    throw new FavoriteStorageError(
      "裝置中的收藏資料格式不正確；為避免覆寫原資料，本次收藏僅保留在目前頁面。",
      parsed.success ? undefined : parsed.error,
    );
  }
  return parsed.data;
}

export function readFavorites(storage: Pick<Storage, "getItem">): Favorite[] {
  let raw: string | null;
  try {
    raw = storage.getItem(FAVORITES_KEY);
  } catch (error) {
    throw new FavoriteStorageError(
      "瀏覽器不允許讀取收藏；本次收藏僅保留在目前頁面。",
      error,
    );
  }
  return decodeFavorites(raw);
}

export function writeFavorites(
  storage: Pick<Storage, "setItem">,
  favorites: readonly Favorite[],
): void {
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (error) {
    throw new FavoriteStorageError(
      "瀏覽器無法儲存收藏（可能是儲存空間不足）；本次收藏僅保留在目前頁面。",
      error,
    );
  }
}

export function toggleFavorite(
  favorites: readonly Favorite[],
  store: Favorite,
): Favorite[] {
  return favorites.some((item) => item.code === store.code)
    ? favorites.filter((item) => item.code !== store.code)
    : [store, ...favorites];
}
