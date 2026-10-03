import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAVORITES_KEY } from "./favorites";
import {
  decodePriceNotes,
  encodePriceNotes,
  findPriceNote,
  formatOriginalPrice,
  parseOriginalPrice,
  PRICE_NOTES_KEY,
  PriceNoteStorageError,
  PriceNoteValidationError,
  readPriceNotes,
  removePriceNote,
  upsertPriceNote,
  writePriceNotes,
  type PriceNote,
} from "./price-notes";

const note: PriceNote = { code: "0065108", name: "惜—食品", priceCents: 3990 };

beforeEach(() => window.localStorage.clear());

describe("personal original price validation", () => {
  it.each([
    ["0.01", 1],
    ["1", 100],
    ["39.5", 3950],
    [" 39.50 ", 3950],
    ["99999.99", 9_999_999],
  ])("parses %s into integer cents", (input, cents) => {
    expect(parseOriginalPrice(input)).toBe(cents);
  });

  it.each([
    "", "0", "0.00", "-1", ".5", "1.", "01", "1.234", "1e3", "1,000",
    "NT$39", "Infinity", "NaN", "100000", "99999.999", "３９",
  ])("rejects invalid input %s", (input) => {
    expect(() => parseOriginalPrice(input)).toThrow(PriceNoteValidationError);
  });

  it("formats whole dollars or two decimal places without calculating a discount", () => {
    expect(formatOriginalPrice(3900)).toBe("NT$39");
    expect(formatOriginalPrice(3950)).toBe("NT$39.50");
    expect(() => formatOriginalPrice(0)).toThrow(PriceNoteValidationError);
  });
});

describe("local-only price notes keyed by official product code", () => {
  it("round-trips a saved price without touching favorites, even across page reads", () => {
    window.localStorage.setItem(FAVORITES_KEY, "existing favorites");
    writePriceNotes(window.localStorage, [note]);
    expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe(encodePriceNotes([note]));
    expect(readPriceNotes(window.localStorage)).toEqual([note]);
    expect(window.localStorage.getItem(FAVORITES_KEY)).toBe("existing favorites");
    expect(decodePriceNotes(null)).toEqual([]);
  });

  it("only finds and updates by code, never by a shared product name", () => {
    const other: PriceNote = { code: "0009999", name: note.name, priceCents: 5000 };
    const both = upsertPriceNote(upsertPriceNote([], note), other);
    expect(findPriceNote(both, note.code)).toEqual(note);
    expect(findPriceNote(both, other.code)).toEqual(other);
    expect(findPriceNote(both, "0459602")).toBeUndefined();
    expect(findPriceNote(both, undefined)).toBeUndefined();
    expect(upsertPriceNote(both, { ...note, priceCents: 4200 })).toEqual([
      { ...note, priceCents: 4200 },
      other,
    ]);
    expect(removePriceNote(both, note.code)).toEqual([other]);
    expect(() => findPriceNote(both, "wrong code")).toThrow(PriceNoteValidationError);
  });

  it("rejects corrupt JSON, invalid records and duplicate codes instead of overwriting them", () => {
    for (const raw of [
      "{broken",
      "{}",
      JSON.stringify([{ ...note, priceCents: 0 }]),
      JSON.stringify([{ ...note, priceCents: 10_000_000 }]),
      JSON.stringify([{ ...note, priceCents: 100.5 }]),
      JSON.stringify([{ ...note, code: "abc" }]),
      JSON.stringify([{ ...note, name: "" }]),
      JSON.stringify([{ ...note, unexpected: "property" }]),
      JSON.stringify([note, { ...note, priceCents: 4200 }]),
    ]) {
      window.localStorage.setItem(PRICE_NOTES_KEY, raw);
      expect(() => readPriceNotes(window.localStorage)).toThrow(PriceNoteStorageError);
      expect(window.localStorage.getItem(PRICE_NOTES_KEY)).toBe(raw);
    }
    expect(() => upsertPriceNote([], { ...note, code: "abc" }))
      .toThrow(PriceNoteValidationError);
    expect(() => removePriceNote([note], "invalid")).toThrow(PriceNoteValidationError);
    const setItem = vi.fn();
    expect(() => writePriceNotes({ setItem }, [note, note])).toThrow(PriceNoteValidationError);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reports browser read/write failures with the original cause", () => {
    const blocked = new Error("blocked");
    try {
      readPriceNotes({ getItem: () => { throw blocked; } });
      throw new Error("Expected a storage error");
    } catch (error) {
      expect(error).toBeInstanceOf(PriceNoteStorageError);
      expect((error as PriceNoteStorageError).cause).toBe(blocked);
    }
    expect(() =>
      writePriceNotes({ setItem: () => { throw new Error("quota"); } }, [note]),
    ).toThrow(/無法儲存個人原價紀錄/);
  });
});
