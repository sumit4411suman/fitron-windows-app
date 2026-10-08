import { describe, expect, it } from "vitest";
import { unzip } from "@/test/xlsx";
import { buildXlsx, colName, crc32, excelDate, sheetName, xml } from "./xlsx";

describe("small helpers", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("names columns A..Z, AA..", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("turns an ISO date into the number Excel stores", () => {
    expect(excelDate("1900-03-01")).toBe(61); // the day after Excel's imaginary 29 Feb 1900
    expect(excelDate("2026-01-01")).toBe(46023);
    expect(excelDate("2026-10-01")).toBe(46296);
    expect(excelDate("2024-02-29")).toBe(excelDate("2024-02-28") + 1);
  });

  it("escapes markup and drops characters XML cannot hold", () => {
    expect(xml(`a & b < c > "d"`)).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
    expect(xml("x\u0000y\u0008z\u001fok\tand\nnewline")).toBe("xyzok\tand\nnewline");
  });

  it("makes a sheet name Excel accepts", () => {
    expect(sheetName("Cash flow: Oct/2026?")).toBe("Cash flow Oct 2026");
    expect(sheetName("[]:*?/\\")).toBe("Sheet1");
    expect(sheetName("A".repeat(50))).toHaveLength(31);
  });
});

describe("buildXlsx", () => {
  const book = () =>
    buildXlsx(
      {
        name: "Collections",
        columns: [{ label: "Date", kind: "date" }, { label: "Member" }, { label: "Amount", kind: "money" }, { label: "Visits", kind: "int" }, { label: "Share", kind: "pct" }],
        rows: [
          ["2026-10-01", "Asha & <Verma>", 177000, 12, 70],
          ["2026-10-02", '=HYPERLINK("http://x","hi")', 50050, 3, 30],
          ["2026-10-03", "  spaced  ", null, null, null],
        ],
        totals: ["Total", null, 227050, 15, null],
      },
      { title: "Collections", now: new Date("2026-10-05T10:00:00Z") },
    );

  it("is a zip holding the parts of a workbook, each with a correct size and checksum", () => {
    const parts = unzip(book());
    expect(Object.keys(parts)).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(parts["[Content_Types].xml"]).toContain("/xl/worksheets/sheet1.xml");
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Collections" sheetId="1" r:id="rId1"/>');
    expect(parts["docProps/core.xml"]).toContain("<dc:title>Collections</dc:title>");
    expect(parts["docProps/core.xml"]).toContain("2026-10-05T10:00:00Z");
  });

  it("stores numbers as numbers, rupees from paise, dates as dates", () => {
    const sheet = unzip(book())["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<c r="A2" s="5"><v>46296</v></c>'); // 2026-10-01 as a date
    expect(sheet).toContain('<c r="C2" s="2"><v>1770</v></c>'); // 177000 paise
    expect(sheet).toContain('<c r="C3" s="2"><v>500.5</v></c>');
    expect(sheet).toContain('<c r="D2" s="3"><v>12</v></c>');
    expect(sheet).toContain('<c r="E2" s="4"><v>70</v></c>');
  });

  it("stores text as text, never as a formula, and escapes it", () => {
    const sheet = unzip(book())["xl/worksheets/sheet1.xml"]!;
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Asha &amp; &lt;Verma&gt;</t></is></c>');
    expect(sheet).toContain("=HYPERLINK(&quot;http://x&quot;,&quot;hi&quot;)");
    expect(sheet).toContain('<t xml:space="preserve">  spaced  </t>'); // spaces kept
  });

  it("has a bold frozen header, a bold totals row, and leaves empty cells out", () => {
    const sheet = unzip(book())["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">'); // header style
    expect(sheet).toContain('<row r="5"><c r="A5" t="inlineStr" s="10">'); // totals: bold on a rule
    expect(sheet).toContain('<c r="C5" s="6"><v>2270.5</v></c>'); // total of money keeps the rupee format, bold
    expect(sheet).not.toContain('r="C4"'); // an empty value is not written
    expect(sheet).toContain('<dimension ref="A1:E5"/>');
  });

  it("sizes columns to their content, within limits", () => {
    const sheet = unzip(book())["xl/worksheets/sheet1.xml"]!;
    const widths = [...sheet.matchAll(/<col min="(\d+)" max="\d+" width="([\d.]+)"/g)].map((m) => Number(m[2]));
    expect(widths).toHaveLength(5);
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(8);
      expect(w).toBeLessThanOrEqual(50);
    }
    expect(widths[1]!).toBeGreaterThan(widths[3]!); // names are wider than counts
  });

  it("copes with no rows, a very long cell, and odd text", () => {
    const empty = unzip(buildXlsx({ name: "Empty", columns: [{ label: "A" }], rows: [] }))["xl/worksheets/sheet1.xml"]!;
    expect(empty).toContain('<dimension ref="A1:A1"/>');
    const long = unzip(buildXlsx({ name: "Long", columns: [{ label: "T" }], rows: [["x".repeat(40_000)]] }))["xl/worksheets/sheet1.xml"]!;
    expect(long.match(/x+/)![0].length).toBeLessThanOrEqual(32_000);
    const odd = unzip(buildXlsx({ name: "Odd", columns: [{ label: "T" }], rows: [["रोहित 💪 \u0000bell"]] }))["xl/worksheets/sheet1.xml"]!;
    expect(odd).toContain("रोहित 💪 bell");
  });

  it("a date-looking value in a text column stays text", () => {
    const sheet = unzip(buildXlsx({ name: "T", columns: [{ label: "Code", kind: "text" }], rows: [["2026-10-01"]] }))["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain("<v>46296</v>");
  });
});
