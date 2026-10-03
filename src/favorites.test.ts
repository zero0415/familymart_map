import { beforeEach, describe, expect, it } from "vitest";
import {
  decodeFavorites,
  FAVORITES_KEY,
  FavoriteStorageError,
  readFavorites,
  toggleFavorite,
  writeFavorites,
} from "./favorites";

beforeEach(() => window.localStorage.clear());

describe("local-only favorites", () => {
  it("preserves codes with leading zeroes and survives a read/write cycle", () => {
    const favorites = toggleFavorite([], { code: "018558", name: "全家台鐵西店" });
    writeFavorites(window.localStorage, favorites);
    expect(window.localStorage.getItem(FAVORITES_KEY)).toContain('"018558"');
    expect(readFavorites(window.localStorage)).toEqual(favorites);
    expect(toggleFavorite(favorites, { code: "018558", name: "全家台鐵西店" })).toEqual([]);
  });

  it("does not overwrite invalid stored data with a success-shaped empty list", () => {
    expect(() => decodeFavorites("{broken")).toThrow(FavoriteStorageError);
    expect(() =>
      decodeFavorites(JSON.stringify([
        { code: "018558", name: "A" },
        { code: "018558", name: "B" },
      ])),
    ).toThrow(/格式不正確/);
    expect(() => decodeFavorites(JSON.stringify([{ code: "abc", name: "A" }])))
      .toThrow(/格式不正確/);
  });

  it("reports browser storage failures explicitly", () => {
    expect(() => readFavorites({ getItem: () => { throw new Error("blocked"); } }))
      .toThrow(/不允許讀取/);
    expect(() =>
      writeFavorites(
        { setItem: () => { throw new Error("quota"); } },
        [{ code: "018558", name: "全家台鐵西店" }],
      ),
    ).toThrow(/無法儲存/);
  });
});
