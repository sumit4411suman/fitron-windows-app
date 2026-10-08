import { describe, expect, it } from "vitest";
import { toCsv } from "./reports";

describe("toCsv", () => {
  it("formats money, quotes commas, and neutralises formulas", () => {
    const csv = toCsv({
      columns: [{ key: "name", label: "Name" }, { key: "amt", label: "Amount", money: true }],
      rows: [
        { name: "Sharma, Priya", amt: 123456 },
        { name: "=HYPERLINK(1)", amt: -500 },
      ],
      totals: { amt: 122956 },
    });
    expect(csv).toBe('Name,Amount\n"Sharma, Priya",1234.56\n\'=HYPERLINK(1),-5.00\nTotal,1229.56\n');
  });
});
