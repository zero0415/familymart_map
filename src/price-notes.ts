import { z } from "zod";
import { PRODUCT_CODE_PATTERN } from "./api";

export const PRICE_NOTES_KEY = "familymart-map:price-notes:v1";
export const MAX_PRICE_CENTS = 9_999_999;

const priceNoteSchema = z.object({
  code: z.string().regex(PRODUCT_CODE_PATTERN),
  name: z.string().trim().min(1),
  priceCents: z.number().int().min(1).max(MAX_PRICE_CENTS),
}).strict();

export type PriceNote = z.infer<typeof priceNoteSchema>;

export class PriceNoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceNoteValidationError";
  }
}

export class PriceNoteStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PriceNoteStorageError";
  }
}

function uniqueCodes(notes: readonly PriceNote[]): boolean {
  return new Set(notes.map((note) => note.code)).size === notes.length;
}

export function parseOriginalPrice(input: string): number {
  const value = input.trim();
  const invalid = () => new PriceNoteValidationError(
    "請輸入 NT$0.01 至 NT$99,999.99 的正數原價（小數最多兩位，不含逗號或貨幣符號）。",
  );
  if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value)) throw invalid();
  const [dollars, fraction = ""] = value.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 1 || cents > MAX_PRICE_CENTS) throw invalid();
  return cents;
}

const wholePriceFormatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const decimalPriceFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatOriginalPrice(priceCents: number): string {
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > MAX_PRICE_CENTS) {
    throw new PriceNoteValidationError("個人原價紀錄的金額無效。");
  }
  const formatter = priceCents % 100 === 0 ? wholePriceFormatter : decimalPriceFormatter;
  return `NT$${formatter.format(priceCents / 100)}`;
}

export function decodePriceNotes(raw: string | null): PriceNote[] {
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new PriceNoteStorageError(
      "裝置中的個人原價紀錄無法解析；為避免覆寫原資料，本次紀錄僅保留在目前頁面。",
      error,
    );
  }

  const parsed = z.array(priceNoteSchema).safeParse(value);
  if (!parsed.success || !uniqueCodes(parsed.data)) {
    throw new PriceNoteStorageError(
      "裝置中的個人原價紀錄格式不正確；為避免覆寫原資料，本次紀錄僅保留在目前頁面。",
      parsed.success ? undefined : parsed.error,
    );
  }
  return parsed.data;
}

export function encodePriceNotes(notes: readonly PriceNote[]): string {
  const parsed = z.array(priceNoteSchema).safeParse(notes);
  if (!parsed.success || !uniqueCodes(parsed.data)) {
    throw new PriceNoteValidationError("個人原價紀錄格式不正確，未覆寫裝置資料。");
  }
  return JSON.stringify(parsed.data);
}

export function readPriceNotes(storage: Pick<Storage, "getItem">): PriceNote[] {
  let raw: string | null;
  try {
    raw = storage.getItem(PRICE_NOTES_KEY);
  } catch (error) {
    throw new PriceNoteStorageError(
      "瀏覽器不允許讀取個人原價紀錄；本次紀錄僅保留在目前頁面。",
      error,
    );
  }
  return decodePriceNotes(raw);
}

export function writePriceNotes(
  storage: Pick<Storage, "setItem">,
  notes: readonly PriceNote[],
): void {
  const raw = encodePriceNotes(notes);
  try {
    storage.setItem(PRICE_NOTES_KEY, raw);
  } catch (error) {
    throw new PriceNoteStorageError(
      "瀏覽器無法儲存個人原價紀錄（可能是儲存空間不足）；本次紀錄僅保留在目前頁面。",
      error,
    );
  }
}

export function findPriceNote(
  notes: readonly PriceNote[],
  code: string | undefined,
): PriceNote | undefined {
  if (code === undefined) return undefined;
  if (!PRODUCT_CODE_PATTERN.test(code)) {
    throw new PriceNoteValidationError("商品代碼無效，無法對應個人原價紀錄。");
  }
  return notes.find((note) => note.code === code);
}

export function upsertPriceNote(notes: readonly PriceNote[], note: PriceNote): PriceNote[] {
  const parsed = priceNoteSchema.safeParse(note);
  if (!parsed.success) {
    throw new PriceNoteValidationError("商品代碼、名稱或原價無效，未儲存個人紀錄。");
  }
  return [parsed.data, ...notes.filter((item) => item.code !== note.code)];
}

export function removePriceNote(notes: readonly PriceNote[], code: string): PriceNote[] {
  if (!PRODUCT_CODE_PATTERN.test(code)) {
    throw new PriceNoteValidationError("商品代碼無效，無法清除個人原價紀錄。");
  }
  return notes.filter((note) => note.code !== code);
}
