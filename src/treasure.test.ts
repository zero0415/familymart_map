import { describe, expect, it } from "vitest";
import type { ListedProduct } from "./stores";
import {
  classifyTreasureProduct,
  DEFAULT_TREASURE_FILTERS,
  filterTreasureProducts,
  hasActiveTreasureFilters,
  hasSavingPrefix,
  treasureCategory,
  treasureDiscount,
  type TreasureFilters,
} from "./treasure";

function product(groupName: string, name: string, category = "官方細分類"): ListedProduct {
  return { groupName, name, category };
}

describe("user-provided treasure discount rules", () => {
  it.each([
    ["美味挖寶", "惜—食品", "food", true, "5折"],
    ["美味挖寶", "一般食品", "food", false, "未知"],
    ["生活好物", "惜-用品", "supplies", true, "3折"],
    ["生活好物", "一般用品", "supplies", false, "5折"],
    ["珍藏酒窖", "惜—酒品", "alcohol", true, "未知"],
    ["珍藏酒窖", "一般酒品", "alcohol", false, "未知"],
  ] as const)("classifies %s / %s without guessing from category text", (
    groupName, name, category, saving, discount,
  ) => {
    expect(classifyTreasureProduct(product(groupName, name, "禁止酒駕／未滿十八歲禁止飲酒")))
      .toEqual({ category, saving, discount });
    expect(treasureCategory(groupName)).toBe(category);
    expect(treasureDiscount(category, saving)).toBe(discount);
  });

  it("recognizes a true 惜-dash prefix, including spaces and common dash variants", () => {
    for (const name of ["惜—商品", "惜-商品", " 惜 — 商品", "惜–商品", "惜－商品", "惜−商品"]) {
      expect(hasSavingPrefix(name)).toBe(true);
    }
    for (const name of ["商品惜—版本", "珍惜-商品", "惜字商品", "惜商品", "一般商品"]) {
      expect(hasSavingPrefix(name)).toBe(false);
    }
  });

  it("marks unknown groups as unknown even when the official category sounds like food", () => {
    expect(classifyTreasureProduct(product("新群組", "惜—驚喜包", "食品")))
      .toEqual({ category: "unknown", saving: true, discount: "未知" });
    expect(treasureCategory("  生活好物  ")).toBe("supplies");
  });
});

describe("favorite treasure product filtering", () => {
  const products = [
    product("美味挖寶", "惜—食品"),
    product("美味挖寶", "一般食品"),
    product("生活好物", "惜-用品"),
    product("生活好物", "一般用品"),
    product("珍藏酒窖", "惜—酒品"),
    product("珍藏酒窖", "一般酒品"),
    product("新群組", "惜-驚喜包", "食品"),
  ];

  it("returns the original unfiltered products without changing their order or details", () => {
    expect(hasActiveTreasureFilters(DEFAULT_TREASURE_FILTERS)).toBe(false);
    expect(filterTreasureProducts(products, DEFAULT_TREASURE_FILTERS)).toBe(products);
  });

  it("intersects category, prefix and discount, while preserving unknown products under 全部", () => {
    const filters: TreasureFilters = {
      category: "supplies",
      prefix: "saving",
      discount: "3折",
    };
    expect(hasActiveTreasureFilters(filters)).toBe(true);
    expect(filterTreasureProducts(products, filters).map(({ name }) => name)).toEqual(["惜-用品"]);
    expect(filterTreasureProducts(products, { ...filters, category: "unknown", discount: "未知" }))
      .toEqual([products[6]]);
    expect(filterTreasureProducts(products, { ...filters, category: "alcohol", discount: "5折" }))
      .toEqual([]);
    expect(products).toHaveLength(7);
  });
});
