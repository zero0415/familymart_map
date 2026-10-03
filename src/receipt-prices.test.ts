import { describe, expect, it } from "vitest";
import {
  findReceiptPrice,
  RECEIPT_PRICE_REFERENCES,
  RECEIPT_REFERENCE_DATE,
} from "./receipt-prices";

const prices = [
  ["0065108", "惜—湖池屋北海道玉米濃湯洋芋片", 3_900, 2_000],
  ["1007870", "惜—爽健美茶", 2_900, 1_500],
  ["1513837", "惜—厚切洋芋片勁辣唐辛子口味", 11_900, 6_000],
  ["0459602", "惜—美粒果蘋果蘇打", 3_500, 1_800],
  ["1477071", "惜—炭火燒牛排口味", 3_900, 2_000],
  ["1493708", "惜—水水灶咖洋芋片—水果啤酒風味", 3_500, 1_800],
  ["1493712", "惜—水水灶咖洋芋片—甘梅芭樂風味", 3_500, 1_800],
  ["1493726", "惜—星星脆哈蜜瓜牛奶口味", 3_000, 1_500],
] as const;

describe("built-in receipt reference prices", () => {
  it("stores exactly eight approved products by official code with price, source and date", () => {
    expect(Object.keys(RECEIPT_PRICE_REFERENCES).sort())
      .toEqual(prices.map(([code]) => code).sort());
    expect(RECEIPT_REFERENCE_DATE).toBe("2026-10-02");

    for (const [code, name, originalCents, halfPriceCents] of prices) {
      const expected = {
        name,
        originalCents,
        halfPriceCents,
        source: "使用者提供收據",
        receiptDate: "2026-10-02",
      };
      expect(RECEIPT_PRICE_REFERENCES[code]).toEqual(expected);
      expect(findReceiptPrice("treasure", code)).toEqual(expected);
    }
  });

  it("rounds each half-dollar up per item and reconciles all ten items", () => {
    const codes = [
      "0065108", "0065108", "1007870", "1513837", "0459602",
      "1477071", "1477071", "1493708", "1493712", "1493726",
    ];
    let originalCents = 0;
    let paidCents = 0;
    let discountCents = 0;

    for (const code of codes) {
      const reference = findReceiptPrice("treasure", code);
      expect(reference).toBeDefined();
      const { originalCents: original, halfPriceCents: paid } = reference!;
      expect(paid).toBe(Math.ceil(original / 200) * 100);
      originalCents += original;
      paidCents += paid;
      discountCents += original - paid;
    }

    expect(codes).toHaveLength(10);
    expect({ originalCents, paidCents, discountCents }).toEqual({
      originalCents: 43_900,
      paidCents: 22_400,
      discountCents: 21_500,
    });
  });

  it("returns no receipt price for other codes or the food map", () => {
    expect(findReceiptPrice("treasure", undefined)).toBeUndefined();
    expect(findReceiptPrice("treasure", "0000000")).toBeUndefined();
    expect(findReceiptPrice("treasure", "00651080")).toBeUndefined();
    expect(findReceiptPrice("treasure", "__proto__")).toBeUndefined();
    expect(findReceiptPrice("food", "0065108")).toBeUndefined();
  });
});
