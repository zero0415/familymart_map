import { describe, expect, it } from "vitest";
import { getNearby, matchesStore, mergeStores, NEARBY_RADIUS_METERS, type MergedStore } from "./stores";
import { makeStore } from "./test-fixtures";

const center = { latitude: 25.0479, longitude: 121.5171 };

describe("store merging by stable code", () => {
  it("combines both maps without adding quantities together or losing zero/missing quantities", () => {
    const merged = mergeStores(
      {
        treasure: [makeStore()],
        food: [
          makeStore({
            name: "全家台鐵西新店名",
            updateDate: "2026-10-04T04:05:00+08:00",
            info: [
              {
                name: "友善食光",
                categories: [
                  {
                    name: "鮮食",
                    products: [
                      { name: "鮮奶", qty: 0 },
                      { name: "飯糰", qty: null },
                    ],
                  },
                ],
              },
            ],
          }),
        ],
      },
      [],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].code).toBe("018558");
    expect(merged[0].name).toBe("全家台鐵西新店名");
    expect(merged[0].sources.treasure?.products).toEqual([
      {
        name: "惜—北海道玉米濃湯洋芋片",
        quantity: 2,
        category: "美味挖寶",
        groupName: "美味挖寶",
        code: "0065108",
      },
    ]);
    expect(merged[0].sources.food).toEqual({
      updatedAt: "2026-10-04T04:05:00+08:00",
      products: [
        {
          name: "鮮奶",
          quantity: 0,
          category: "鮮食",
          groupName: "友善食光",
          code: undefined,
        },
        {
          name: "飯糰",
          quantity: undefined,
          category: "鮮食",
          groupName: "友善食光",
          code: undefined,
        },
      ],
    });

    describe("complete three-kilometer directory range", () => {
      it("includes stores 1.2-2.9 km away, excludes beyond 3 km, and sorts by measured distance", () => {
        const latitudesPerMeter = (180 / Math.PI) / 6_371_000;
        const atDistance = (code: string, meters: number): MergedStore => ({
          code,
          name: `全家${code}店`,
          latitude: center.latitude + meters * latitudesPerMeter,
          longitude: center.longitude,
          sources: {},
        });
        const listed = getNearby([
          atDistance("2.9km", 2_900),
          atDistance("3.1km", 3_100),
          atDistance("1.2km", 1_200),
          atDistance("3.0km", 3_000),
          atDistance("0.5km", 500),
        ], center);

        expect(NEARBY_RADIUS_METERS).toBe(3_000);
        expect(listed.map(({ store }) => store.code)).toEqual(["0.5km", "1.2km", "2.9km", "3.0km"]);
        expect(listed[1].distanceMeters).toBeCloseTo(1_200, 3);
        expect(listed[2].distanceMeters).toBeCloseTo(2_900, 3);
        expect(listed.every(({ distanceMeters }) => distanceMeters <= 3_000)).toBe(true);
      });
    });
  });

  it("keeps favorites without map data and does not label distant favorites as nearby", () => {
    const favorites = [
      { code: "888888", name: "全家舊收藏" },
      { code: "009999", name: "全家南方店" },
    ];
    const stores = mergeStores(
      {
        treasure: [
          makeStore(),
          makeStore({
            oldPKey: "009999",
            name: "全家南方店",
            latitude: 22.6396,
            longitude: 120.302,
            distance: 320_000,
          }),
        ],
        food: [],
      },
      favorites,
    );

    expect(stores.find((store) => store.code === "888888")).toMatchObject({
      name: "全家舊收藏",
      sources: {},
    });
    expect(getNearby(stores, center).map(({ store }) => store.code)).toEqual(["018558"]);
    expect(matchesStore(stores.find((store) => store.code === "018558")!, "０１８５５８")).toBe(true);
    expect(matchesStore(stores.find((store) => store.code === "018558")!, "台鐵西")).toBe(true);
  });
});
