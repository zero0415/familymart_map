import type { MapSource } from "./api";

export const RECEIPT_REFERENCE_DATE = "2026-10-02";

export interface ReceiptPriceReference {
  readonly name: string;
  readonly originalCents: number;
  readonly halfPriceCents: number;
  readonly source: "使用者提供收據";
  readonly receiptDate: typeof RECEIPT_REFERENCE_DATE;
}

const receiptContext = {
  source: "使用者提供收據",
  receiptDate: RECEIPT_REFERENCE_DATE,
} as const;

export const RECEIPT_PRICE_REFERENCES: Readonly<Record<string, ReceiptPriceReference>> = {
  "0065108": {
    ...receiptContext,
    name: "惜—湖池屋北海道玉米濃湯洋芋片",
    originalCents: 3_900,
    halfPriceCents: 2_000,
  },
  "1007870": {
    ...receiptContext,
    name: "惜—爽健美茶",
    originalCents: 2_900,
    halfPriceCents: 1_500,
  },
  "1513837": {
    ...receiptContext,
    name: "惜—厚切洋芋片勁辣唐辛子口味",
    originalCents: 11_900,
    halfPriceCents: 6_000,
  },
  "0459602": {
    ...receiptContext,
    name: "惜—美粒果蘋果蘇打",
    originalCents: 3_500,
    halfPriceCents: 1_800,
  },
  "1477071": {
    ...receiptContext,
    name: "惜—炭火燒牛排口味",
    originalCents: 3_900,
    halfPriceCents: 2_000,
  },
  "1493708": {
    ...receiptContext,
    name: "惜—水水灶咖洋芋片—水果啤酒風味",
    originalCents: 3_500,
    halfPriceCents: 1_800,
  },
  "1493712": {
    ...receiptContext,
    name: "惜—水水灶咖洋芋片—甘梅芭樂風味",
    originalCents: 3_500,
    halfPriceCents: 1_800,
  },
  "1493726": {
    ...receiptContext,
    name: "惜—星星脆哈蜜瓜牛奶口味",
    originalCents: 3_000,
    halfPriceCents: 1_500,
  },
};

export function findReceiptPrice(
  source: MapSource,
  code: string | undefined,
): ReceiptPriceReference | undefined {
  if (source !== "treasure" || !code) return undefined;
  return Object.hasOwn(RECEIPT_PRICE_REFERENCES, code)
    ? RECEIPT_PRICE_REFERENCES[code]
    : undefined;
}
