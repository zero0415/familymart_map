import { describe, expect, it, vi } from "vitest";
import {
  buildStoreDirectory,
  deriveMapStoreCode,
  DirectoryClient,
  DirectoryError,
  isDirectoryStale,
  matchesDirectoryStore,
  parseStoreDirectory,
  type DirectoryStore,
} from "./directory";
import { makeStore } from "./test-fixtures";

function rawStore(index: number) {
  return {
    pkeynew: String(200_000 + index),
    Name: `全家測試${index}店`,
    addr: `臺北市中正區測試路${index}號`,
    serid: String(50_000 + index),
    px_wgs84: "121.5171",
    py_wgs84: "25.0479",
    Tel: "02-00000000",
  };
}

function validRows() {
  return Array.from({ length: 4_000 }, (_, index) => rawStore(index));
}

describe("official store directory snapshot", () => {
  it("derives the map's oldPKey from serid, never from the different directory pkeynew", () => {
    expect(deriveMapStoreCode("58687")).toBe("018687");
    expect(deriveMapStoreCode("15336")).toBe("005336");
    expect(deriveMapStoreCode("65336")).toBe("025336");
    expect(deriveMapStoreCode("58687")).not.toBe("023510");
    for (const invalid of ["", "5868", "158687", "28687", "78687", "abcde", "58 87"]) {
      expect(() => deriveMapStoreCode(invalid)).toThrow(DirectoryError);
    }
  });

  it("validates all rows, unique new and old codes, completeness, and outlying coordinates", () => {
    const rows = validRows();
    rows[0] = {
      ...rawStore(0),
      pkeynew: "023510",
      serid: "58687",
      Name: "全家台鐵一店",
    };
    rows[1] = { ...rows[1], px_wgs84: "23.124895" };
    const snapshot = buildStoreDirectory(rows, "2026-10-04T00:00:00.000Z");
    expect(snapshot.stores).toHaveLength(4_000);
    expect(snapshot.stores[0]).toMatchObject({ code: "018687", name: "全家台鐵一店" });
    expect(snapshot.stores[0].code).not.toBe(rows[0].pkeynew);
    expect(snapshot.unlocatedCount).toBe(1);
    expect(snapshot.stores[1]).toMatchObject({ latitude: null, longitude: null });
    expect(parseStoreDirectory(snapshot)).toEqual(snapshot);
    expect(() => parseStoreDirectory({ ...snapshot, stores: snapshot.stores.slice(0, 1) }))
      .toThrow("格式不正確");
    expect(() => parseStoreDirectory({ ...snapshot, unlocatedCount: 0 }))
      .toThrow("座標筆數不一致");

    const duplicateDirectoryCode = validRows();
    duplicateDirectoryCode[2] = { ...duplicateDirectoryCode[2], pkeynew: duplicateDirectoryCode[1].pkeynew };
    expect(() => buildStoreDirectory(duplicateDirectoryCode, snapshot.updatedAt)).toThrow("重複");
    const duplicateMapCode = validRows();
    duplicateMapCode[2] = { ...duplicateMapCode[2], serid: duplicateMapCode[1].serid };
    expect(() => buildStoreDirectory(duplicateMapCode, snapshot.updatedAt)).toThrow("重複");
    const malformed = validRows();
    malformed[0] = { ...malformed[0], serid: "28687" };
    expect(() => buildStoreDirectory(malformed, snapshot.updatedAt)).toThrow("格式錯誤");
    const badCoordinates = validRows();
    badCoordinates[0] = { ...badCoordinates[0], px_wgs84: "not-a-coordinate" };
    expect(() => buildStoreDirectory(badCoordinates, snapshot.updatedAt)).toThrow("格式錯誤");
    const mostlyOutliers = validRows();
    for (let index = 0; index < 11; index++) {
      mostlyOutliers[index] = { ...mostlyOutliers[index], px_wgs84: "23.124895" };
    }
    expect(() => buildStoreDirectory(mostlyOutliers, snapshot.updatedAt)).toThrow("過多異常座標");
    expect(() => buildStoreDirectory(validRows().slice(0, 3_999), snapshot.updatedAt))
      .toThrow("筆數異常");
  });

  it("rejects a same-name different-code or distant/wrong-name map response before showing products", () => {
    const store: DirectoryStore = {
      code: "018687",
      name: "全家台鐵一店",
      address: "台北市中正區北平西路3號B1",
      latitude: 25.0477,
      longitude: 121.517044,
    };
    const official = makeStore({
      oldPKey: "018687",
      name: store.name,
      latitude: 25.047203,
      longitude: 121.517044,
    });
    expect(matchesDirectoryStore(store, official)).toBe(true);
    expect(matchesDirectoryStore(store, { ...official, oldPKey: "023510" })).toBe(false);
    expect(matchesDirectoryStore(store, { ...official, name: "全家台鐵二店" })).toBe(false);
    expect(matchesDirectoryStore(store, { ...official, latitude: 25.0493 })).toBe(false);
    expect(matchesDirectoryStore({ ...store, latitude: null, longitude: null }, official)).toBe(false);
  });

  it("loads the same-origin JSON only when requested, caches success and retries explicit failures", async () => {
    const snapshot = buildStoreDirectory(validRows(), "2026-10-04T00:00:00.000Z");
    let attempts = 0;
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      attempts += 1;
      return attempts === 1
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify(snapshot));
    });
    const client = new DirectoryClient(request);
    expect(request).not.toHaveBeenCalled();
    await expect(client.load()).rejects.toMatchObject({ kind: "http" });
    const loaded = await client.load();
    expect(loaded.stores).toHaveLength(4_000);
    expect(await client.load()).toBe(loaded);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(
      `${import.meta.env.BASE_URL}store-directory.json`,
      expect.objectContaining({ credentials: "omit", mode: "same-origin" }),
    );
    await expect(new DirectoryClient(async () => new Response("not-json")).load())
      .rejects.toMatchObject({ kind: "response" });
    await expect(new DirectoryClient(async () => new Response("{}")).load())
      .rejects.toMatchObject({ kind: "response" });
    expect(isDirectoryStale(snapshot.updatedAt, Date.parse("2026-10-06T01:00:00Z"))).toBe(true);
    expect(isDirectoryStale(snapshot.updatedAt, Date.parse("2026-10-05T00:00:00Z"))).toBe(false);
  });
});
