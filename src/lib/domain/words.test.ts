import { describe, expect, it } from "vitest";
import { amountInWords, numberInWords } from "./words";

describe("amounts in words", () => {
  it("uses Indian grouping", () => {
    expect(numberInWords(0)).toBe("Zero");
    expect(numberInWords(7)).toBe("Seven");
    expect(numberInWords(19)).toBe("Nineteen");
    expect(numberInWords(42)).toBe("Forty Two");
    expect(numberInWords(100)).toBe("One Hundred");
    expect(numberInWords(999)).toBe("Nine Hundred Ninety Nine");
    expect(numberInWords(2000)).toBe("Two Thousand");
    expect(numberInWords(125000)).toBe("One Lakh Twenty Five Thousand");
    expect(numberInWords(10_000_000)).toBe("One Crore");
    expect(numberInWords(123_456_789)).toBe("Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine");
    // Above 99 crore the crores themselves are grouped.
    expect(numberInWords(1_500_000_000)).toBe("One Hundred Fifty Crore");
  });

  it("writes rupees and paise", () => {
    expect(amountInWords(200000)).toBe("Rupees Two Thousand only");
    expect(amountInWords(200050)).toBe("Rupees Two Thousand and Fifty Paise only");
    expect(amountInWords(118000)).toBe("Rupees One Thousand One Hundred Eighty only");
    expect(amountInWords(5)).toBe("Five Paise only");
    expect(amountInWords(0)).toBe("Zero rupees only");
  });

  it("refuses what is not a whole number of paise", () => {
    expect(() => amountInWords(10.5)).toThrow(RangeError);
    expect(() => amountInWords(-100)).toThrow(RangeError);
  });
});
