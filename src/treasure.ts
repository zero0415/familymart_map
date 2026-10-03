import type { ListedProduct } from "./stores";

export type TreasureCategory = "food" | "supplies" | "alcohol" | "unknown";
export type TreasureDiscount = "5折" | "3折" | "未知";
export type TreasurePrefix = "saving" | "regular";

export interface TreasureFilters {
  category: "all" | TreasureCategory;
  prefix: "all" | TreasurePrefix;
  discount: "all" | TreasureDiscount;
}

export const DEFAULT_TREASURE_FILTERS: TreasureFilters = {
  category: "all",
  prefix: "all",
  discount: "all",
};

export const TREASURE_CATEGORY_LABELS: Record<TreasureCategory, string> = {
  food: "食品",
  supplies: "用品",
  alcohol: "酒品",
  unknown: "類別未知",
};

export function treasureCategory(groupName: string): TreasureCategory {
  switch (groupName.trim()) {
    case "美味挖寶":
      return "food";
    case "生活好物":
      return "supplies";
    case "珍藏酒窖":
      return "alcohol";
    default:
      return "unknown";
  }
}

export function hasSavingPrefix(name: string): boolean {
  return /^\s*惜\s*[-\u2010-\u2015\u2212\uFF0D]/u.test(name);
}

export function treasureDiscount(category: TreasureCategory, saving: boolean): TreasureDiscount {
  switch (category) {
    case "food":
      return saving ? "5折" : "未知";
    case "supplies":
      return saving ? "3折" : "5折";
    case "alcohol":
    case "unknown":
      return "未知";
  }
}

export function classifyTreasureProduct(product: Pick<ListedProduct, "name" | "groupName">) {
  const category = treasureCategory(product.groupName);
  const saving = hasSavingPrefix(product.name);
  return { category, saving, discount: treasureDiscount(category, saving) };
}

export function hasActiveTreasureFilters(filters: TreasureFilters): boolean {
  return filters.category !== "all" || filters.prefix !== "all" || filters.discount !== "all";
}

export function filterTreasureProducts(
  products: readonly ListedProduct[],
  filters: TreasureFilters,
): readonly ListedProduct[] {
  if (!hasActiveTreasureFilters(filters)) return products;
  return products.filter((product) => {
    const { category, saving, discount } = classifyTreasureProduct(product);
    return (
      (filters.category === "all" || category === filters.category) &&
      (filters.prefix === "all" || (saving ? "saving" : "regular") === filters.prefix) &&
      (filters.discount === "all" || discount === filters.discount)
    );
  });
}
